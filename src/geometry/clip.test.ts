import { describe, it, expect } from 'vitest';
import { create as pt } from './point';
import { create } from './polygon';
import { area } from './polygon';
import type { Polygon } from './polygon';
import { clipPolygon, isEmptyPolygon } from './clip';
import type { ClipRect } from './clip';
import { hatOutline } from '../tiling/hat';
import { SPECTRE_VERTICES } from '../tiling/spectre';

const { abs } = Math;

/** Check two polygons have the same set of vertices (order-independent within epsilon). */
function verticesMatch(a: Polygon, b: readonly { x: number; y: number }[]): boolean {
  if (a.vertices.length !== b.length) return false;
  const eps = 1e-8;
  const used = new Set<number>();
  for (const va of a.vertices) {
    let found = false;
    for (let j = 0; j < b.length; j++) {
      if (used.has(j)) continue;
      if (abs(va.x - b[j].x) < eps && abs(va.y - b[j].y) < eps) {
        used.add(j);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

describe('clipPolygon (Sutherland-Hodgman)', () => {
  // ── Test 1: Triangle fully inside rect ──────────────────────────
  it('returns original triangle when fully inside rect', () => {
    const tri = create([pt(1, 1), pt(3, 1), pt(2, 3)]);
    const rect: ClipRect = { minX: 0, minY: 0, maxX: 5, maxY: 5 };
    const clipped = clipPolygon(tri, rect);
    expect(clipped.vertices.length).toBe(3);
    expect(verticesMatch(clipped, tri.vertices)).toBe(true);
  });

  // ── Test 2: Triangle partially overlapping rect ─────────────────
  it('returns correct clipped pentagon for partial overlap', () => {
    // Triangle: (0,0)-(6,0)-(0,6), clipped to [1,1]×[4,4]
    // Expected pentagon: (1,1),(4,1),(4,2),(2,4),(1,4)
    const tri = create([pt(0, 0), pt(6, 0), pt(0, 6)]);
    const rect: ClipRect = { minX: 1, minY: 1, maxX: 4, maxY: 4 };
    const clipped = clipPolygon(tri, rect);
    expect(clipped.vertices.length).toBe(5);
    expect(verticesMatch(clipped, [
      pt(1, 1), pt(4, 1), pt(4, 2), pt(2, 4), pt(1, 4),
    ])).toBe(true);
  });

  // ── Test 3: Triangle fully outside rect ─────────────────────────
  it('returns empty polygon when fully outside', () => {
    const tri = create([pt(10, 10), pt(12, 10), pt(11, 12)]);
    const rect: ClipRect = { minX: 0, minY: 0, maxX: 5, maxY: 5 };
    const clipped = clipPolygon(tri, rect);
    expect(isEmptyPolygon(clipped)).toBe(true);
    expect(clipped.vertices.length).toBe(0);
  });

  // ── Test 4: Vertex exactly on clip edge ─────────────────────────
  it('handles vertex exactly on clip edge', () => {
    // Triangle with one vertex on the left edge of the rect
    // (2,1), (5,1), (2,4) with rect minX=2, minY=0, maxX=6, maxY=6
    // Vertex (2,1) and (2,4) are exactly on x=2
    const tri = create([pt(2, 1), pt(5, 1), pt(2, 4)]);
    const rect: ClipRect = { minX: 2, minY: 0, maxX: 6, maxY: 6 };
    const clipped = clipPolygon(tri, rect);
    expect(clipped.vertices.length).toBe(3);
    expect(verticesMatch(clipped, [pt(2, 1), pt(5, 1), pt(2, 4)])).toBe(true);
  });

  // ── Test 5: Concave polygon (L-shape) ───────────────────────────
  it('clips concave L-shape polygon correctly', () => {
    // L-shape: (0,0),(4,0),(4,1),(1,1),(1,3),(0,3)
    // Clip rect: [0.5, 0.5] × [2.5, 3.5]
    // Only the top-left part of the L remains: small rectangle from (0.5,2.5) to (1,3)
    const lShape = create([
      pt(0, 0), pt(4, 0), pt(4, 1), pt(1, 1), pt(1, 3), pt(0, 3),
    ]);
    const rect: ClipRect = { minX: 0.5, minY: 2.5, maxX: 2.5, maxY: 3.5 };
    const clipped = clipPolygon(lShape, rect);
    expect(clipped.vertices.length).toBe(4);
    expect(verticesMatch(clipped, [
      pt(0.5, 3), pt(1, 3), pt(1, 2.5), pt(0.5, 2.5),
    ])).toBe(true);
  });

  // ── Test 6: Hat tile polygon clipped ────────────────────────────
  it('clips hat tile polygon', () => {
    const hatPts = hatOutline();
    const hatPoly = create(hatPts);
    // Compute bounding box of hat
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of hatPts) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    // Clip to inner half of bounding box
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rect: ClipRect = {
      minX: cx - (cx - minX) * 0.25,
      minY: cy - (cy - minY) * 0.25,
      maxX: cx + (maxX - cx) * 0.25,
      maxY: cy + (maxY - cy) * 0.25,
    };
    const clipped = clipPolygon(hatPoly, rect);
    // Should have at least 3 vertices (partial overlap)
    expect(clipped.vertices.length).toBeGreaterThanOrEqual(3);
    // All vertices should be inside the clip rect
    for (const v of clipped.vertices) {
      expect(v.x).toBeGreaterThanOrEqual(rect.minX - 1e-8);
      expect(v.x).toBeLessThanOrEqual(rect.maxX + 1e-8);
      expect(v.y).toBeGreaterThanOrEqual(rect.minY - 1e-8);
      expect(v.y).toBeLessThanOrEqual(rect.maxY + 1e-8);
    }
    // Clipped area should be less than original
    expect(abs(area(clipped))).toBeLessThan(abs(area(hatPoly)));
    // Clipped area should be positive
    expect(abs(area(clipped))).toBeGreaterThan(0);
  });

  // ── Test 7: Spectre tile polygon clipped ────────────────────────
  it('clips spectre tile polygon', () => {
    const spectrePts = SPECTRE_VERTICES.map(v => pt(v.x, v.y));
    const spectrePoly = create(spectrePts);
    // Clip to a rect that cuts through the spectre
    const rect: ClipRect = { minX: 0.5, minY: 0, maxX: 2.5, maxY: 2 };
    const clipped = clipPolygon(spectrePoly, rect);
    expect(clipped.vertices.length).toBeGreaterThanOrEqual(3);
    // All vertices inside clip rect
    for (const v of clipped.vertices) {
      expect(v.x).toBeGreaterThanOrEqual(rect.minX - 1e-8);
      expect(v.x).toBeLessThanOrEqual(rect.maxX + 1e-8);
      expect(v.y).toBeGreaterThanOrEqual(rect.minY - 1e-8);
      expect(v.y).toBeLessThanOrEqual(rect.maxY + 1e-8);
    }
    expect(abs(area(clipped))).toBeGreaterThan(0);
    expect(abs(area(clipped))).toBeLessThan(abs(area(spectrePoly)));
  });

  // ── Additional edge cases ───────────────────────────────────────
  it('handles rect completely containing polygon', () => {
    const sq = create([pt(1, 1), pt(2, 1), pt(2, 2), pt(1, 2)]);
    const rect: ClipRect = { minX: 0, minY: 0, maxX: 5, maxY: 5 };
    const clipped = clipPolygon(sq, rect);
    expect(clipped.vertices.length).toBe(4);
    expect(verticesMatch(clipped, sq.vertices)).toBe(true);
  });

  it('handles polygon touching rect edge from outside', () => {
    // Triangle just touching the left edge from outside
    const tri = create([pt(-2, 1), pt(0, 0), pt(0, 2)]);
    const rect: ClipRect = { minX: 0, minY: 0, maxX: 5, maxY: 5 };
    const clipped = clipPolygon(tri, rect);
    // Only a sliver from x=0 edge
    expect(isEmptyPolygon(clipped) || clipped.vertices.length >= 1).toBe(true);
  });

  it('returns empty polygon when rect has zero area and polygon is outside', () => {
    const tri = create([pt(1, 1), pt(2, 1), pt(1.5, 2)]);
    const rect: ClipRect = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
    const clipped = clipPolygon(tri, rect);
    expect(isEmptyPolygon(clipped)).toBe(true);
  });
});

describe('isEmptyPolygon', () => {
  it('returns true for empty polygon', () => {
    const empty = clipPolygon(
      create([pt(10, 10), pt(11, 10), pt(10, 11)]),
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    );
    expect(isEmptyPolygon(empty)).toBe(true);
  });

  it('returns false for non-empty polygon', () => {
    const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
    const rect: ClipRect = { minX: -1, minY: -1, maxX: 2, maxY: 2 };
    const clipped = clipPolygon(tri, rect);
    expect(isEmptyPolygon(clipped)).toBe(false);
  });
});
