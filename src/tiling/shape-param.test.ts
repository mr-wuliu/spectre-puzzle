import { describe, it, expect } from 'vitest';
import * as point from '../geometry/point';
import type { Point } from '../geometry/point';
import { hatOutline } from './hat';
import { SPECTRE_VERTICES } from './spectre';
import { generateTileVertices } from './shape-param';

const EPS = 1e-10;

// ─── Helpers ────────────────────────────────────────────────────

function edgeLengths(verts: Point[]): number[] {
  const n = verts.length;
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    lengths.push(point.distance(verts[i], verts[(i + 1) % n]));
  }
  return lengths;
}

/** Cross product of (b-a) x (p-a). */
function cross3(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Strict segment intersection test. */
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross3(c, d, a);
  const d2 = cross3(c, d, b);
  const d3 = cross3(a, b, c);
  const d4 = cross3(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/** Check polygon is simple (no non-adjacent edges cross). */
function isSimplePolygon(verts: Point[]): boolean {
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(
        verts[i], verts[(i + 1) % n],
        verts[j], verts[(j + 1) % n],
      )) {
        return false;
      }
    }
  }
  return true;
}

/** Signed area (positive = CCW). */
function signedArea(verts: Point[]): number {
  let area = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return area / 2;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('generateTileVertices', () => {
  // ── Endpoint matching ────────────────────────────────────────

  it('returns 13 hatOutline() vertices at param=0', () => {
    const verts = generateTileVertices(0);
    const hat = hatOutline();
    expect(verts).toHaveLength(13);
    for (let i = 0; i < 13; i++) {
      expect(
        point.equals(verts[i], hat[i], EPS),
        `vertex ${i}: got (${verts[i].x},${verts[i].y}) expected (${hat[i].x},${hat[i].y})`,
      ).toBe(true);
    }
  });

  it('returns 14 SPECTRE_VERTICES at param=1', () => {
    const verts = generateTileVertices(1);
    expect(verts).toHaveLength(14);
    for (let i = 0; i < 14; i++) {
      expect(
        point.equals(verts[i], SPECTRE_VERTICES[i], EPS),
        `vertex ${i}: got (${verts[i].x},${verts[i].y}) expected (${SPECTRE_VERTICES[i].x},${SPECTRE_VERTICES[i].y})`,
      ).toBe(true);
    }
  });

  it('returns a new array at param=1 (not the frozen original)', () => {
    const verts = generateTileVertices(1);
    expect(verts).not.toBe(SPECTRE_VERTICES);
  });

  // ── Clamping ─────────────────────────────────────────────────

  it('clamps negative param to 0 (returns Hat)', () => {
    const v0 = generateTileVertices(0);
    const vn = generateTileVertices(-0.5);
    expect(vn).toHaveLength(v0.length);
    for (let i = 0; i < v0.length; i++) {
      expect(point.equals(vn[i], v0[i], EPS)).toBe(true);
    }
  });

  it('clamps param > 1 to 1 (returns Spectre)', () => {
    const v1 = generateTileVertices(1);
    const v2 = generateTileVertices(1.5);
    expect(v2).toHaveLength(v1.length);
    for (let i = 0; i < v1.length; i++) {
      expect(point.equals(v2[i], v1[i], EPS)).toBe(true);
    }
  });

  // ── Intermediate values ──────────────────────────────────────

  it('returns 14 vertices for 0 < param < 1', () => {
    for (const t of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      expect(generateTileVertices(t)).toHaveLength(14);
    }
  });

  it('produces CCW (positive area) polygons for intermediate param', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const area = signedArea(generateTileVertices(t));
      expect(area).toBeGreaterThan(0);
    }
  });

  it('produces simple (non-self-intersecting) polygons for intermediate param', () => {
    for (const t of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      expect(
        isSimplePolygon(generateTileVertices(t)),
        `param=${t} produced self-intersecting polygon`,
      ).toBe(true);
    }
  });

  it('all edges are non-degenerate for intermediate param', () => {
    for (const t of [0.1, 0.5, 0.9]) {
      const lengths = edgeLengths(generateTileVertices(t));
      for (const len of lengths) {
        expect(len).toBeGreaterThan(0.5);
      }
    }
  });

  // ── Tile(1,b) edge length verification ───────────────────────

  it('type-b edges (2,3,6,7,12,13) have length √3*(1-t)+t at param=0.5', () => {
    const t = 0.5;
    const verts = generateTileVertices(t);
    const SQRT3 = Math.sqrt(3);
    const expectedBLen = SQRT3 * (1 - t) + t;
    const typeBEdges = [2, 3, 6, 7, 12, 13];
    for (const i of typeBEdges) {
      const j = (i + 1) % 14;
      const dist = point.distance(verts[i], verts[j]);
      expect(dist).toBeCloseTo(expectedBLen, 6);
    }
  });

  it('type-a edges (0,1,4,5,8,9,10,11) always have length 1 at param=0.5', () => {
    const t = 0.5;
    const verts = generateTileVertices(t);
    const typeAEdges = [0, 1, 4, 5, 8, 9, 10, 11];
    for (const i of typeAEdges) {
      const j = (i + 1) % 14;
      const dist = point.distance(verts[i], verts[j]);
      expect(dist).toBeCloseTo(1, 6);
    }
  });

  // ── Continuity ───────────────────────────────────────────────

  it('vertices change smoothly with small param changes', () => {
    const v1 = generateTileVertices(0.49);
    const v2 = generateTileVertices(0.50);
    const v3 = generateTileVertices(0.51);
    expect(v1).toHaveLength(14);
    expect(v2).toHaveLength(14);
    expect(v3).toHaveLength(14);
    for (let i = 0; i < 14; i++) {
      const d12 = point.distance(v1[i], v2[i]);
      const d23 = point.distance(v2[i], v3[i]);
      expect(d12).toBeLessThan(0.05);
      expect(d23).toBeLessThan(0.05);
    }
  });
});
