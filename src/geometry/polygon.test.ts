import { describe, it, expect } from 'vitest';
import type { Point } from './point';
import { create as pt, equals } from './point';
import {
  create,
  centroid,
  boundingBox,
  area,
  containsPoint,
  translate,
  rotate,
  scale,
  clone,
  edges,
  perimeter,
  numVertices,
} from './polygon';
import type { Polygon } from './polygon';

const PI = Math.PI;
const { abs, sqrt } = Math;

describe('Polygon', () => {
  describe('create', () => {
    it('creates a polygon from 3 vertices', () => {
      const poly = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      expect(numVertices(poly)).toBe(3);
    });

    it('creates a polygon from more vertices', () => {
      const poly = create([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)]);
      expect(numVertices(poly)).toBe(4);
    });

    it('throws for fewer than 3 vertices', () => {
      expect(() => create([pt(0, 0), pt(1, 0)])).toThrow();
      expect(() => create([pt(0, 0)])).toThrow();
      expect(() => create([])).toThrow();
    });

    it('copies vertices (deep copy)', () => {
      const verts = [pt(0, 0), pt(1, 0), pt(0, 1)];
      const poly = create(verts);
      verts[0] = pt(99, 99);
      expect(equals(poly.vertices[0], pt(0, 0))).toBe(true);
    });
  });

  describe('area', () => {
    it('triangle area = base * height / 2', () => {
      const tri = create([pt(0, 0), pt(4, 0), pt(0, 3)]);
      expect(abs(area(tri) - 6)).toBeLessThan(1e-10);
    });

    it('square area = side^2', () => {
      const sq = create([pt(0, 0), pt(5, 0), pt(5, 5), pt(0, 5)]);
      expect(abs(area(sq) - 25)).toBeLessThan(1e-10);
    });

    it('CCW polygon has positive area', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      expect(area(tri)).toBeGreaterThan(0);
    });

    it('CW polygon has negative area', () => {
      const tri = create([pt(0, 0), pt(0, 1), pt(1, 0)]);
      expect(area(tri)).toBeLessThan(0);
    });

    it('rectangle area', () => {
      const rect = create([pt(0, 0), pt(6, 0), pt(6, 4), pt(0, 4)]);
      expect(abs(area(rect) - 24)).toBeLessThan(1e-10);
    });
  });

  describe('centroid', () => {
    it('centroid of square is center', () => {
      const sq = create([pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2)]);
      const c = centroid(sq);
      expect(abs(c.x - 1)).toBeLessThan(1e-10);
      expect(abs(c.y - 1)).toBeLessThan(1e-10);
    });

    it('centroid of triangle', () => {
      const tri = create([pt(0, 0), pt(6, 0), pt(0, 3)]);
      const c = centroid(tri);
      expect(abs(c.x - 2)).toBeLessThan(1e-10);
      expect(abs(c.y - 1)).toBeLessThan(1e-10);
    });
  });

  describe('boundingBox', () => {
    it('square bounding box', () => {
      const sq = create([pt(1, 1), pt(3, 1), pt(3, 3), pt(1, 3)]);
      const bb = boundingBox(sq);
      expect(equals(bb.min, pt(1, 1))).toBe(true);
      expect(equals(bb.max, pt(3, 3))).toBe(true);
    });

    it('triangle bounding box', () => {
      const tri = create([pt(0, 0), pt(4, 0), pt(2, 3)]);
      const bb = boundingBox(tri);
      expect(equals(bb.min, pt(0, 0))).toBe(true);
      expect(equals(bb.max, pt(4, 3))).toBe(true);
    });

    it('polygon with negative coordinates', () => {
      const poly = create([pt(-2, -1), pt(1, -1), pt(1, 2), pt(-2, 2)]);
      const bb = boundingBox(poly);
      expect(equals(bb.min, pt(-2, -1))).toBe(true);
      expect(equals(bb.max, pt(1, 2))).toBe(true);
    });
  });

  describe('containsPoint', () => {
    it('point inside square', () => {
      const sq = create([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)]);
      expect(containsPoint(sq, pt(2, 2))).toBe(true);
    });

    it('point outside square', () => {
      const sq = create([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)]);
      expect(containsPoint(sq, pt(5, 5))).toBe(false);
    });

    it('point on edge', () => {
      const sq = create([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)]);
      expect(containsPoint(sq, pt(2, 0))).toBe(true);
    });

    it('point at vertex', () => {
      const sq = create([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)]);
      expect(containsPoint(sq, pt(0, 0))).toBe(true);
    });

    it('concave L-shape: inside concavity', () => {
      // L-shape:
      //  2 |# # #
      //  1 |# # #
      //  0 |# # # # #
      //    0 1 2 3 4
      // Full L: (0,0),(4,0),(4,1),(1,1),(1,2),(0,2)
      const lShape = create([
        pt(0, 0), pt(4, 0), pt(4, 1), pt(1, 1), pt(1, 2), pt(0, 2),
      ]);
      // Inside the concavity at (2, 1.5) should be OUTSIDE
      expect(containsPoint(lShape, pt(2, 1.5))).toBe(false);
      // Inside the main body at (0.5, 0.5)
      expect(containsPoint(lShape, pt(0.5, 0.5))).toBe(true);
      // Inside the bottom arm at (3, 0.5)
      expect(containsPoint(lShape, pt(3, 0.5))).toBe(true);
    });

    it('concave polygon: point inside notch', () => {
      // Arrow/chevron shape pointing right
      // (0,2) -> (2,1) -> (4,2) -> (4,0) -> (2,1) -> (0,0)
      // Actually let's use a simpler concave shape
      // U-shape: (0,0),(3,0),(3,3),(2,3),(2,1),(1,1),(1,3),(0,3)
      const uShape = create([
        pt(0, 0), pt(3, 0), pt(3, 3), pt(2, 3), pt(2, 1), pt(1, 1), pt(1, 3), pt(0, 3),
      ]);
      // Inside the U cavity at (1.5, 2) should be OUTSIDE
      expect(containsPoint(uShape, pt(1.5, 2))).toBe(false);
      // Inside left leg at (0.5, 1)
      expect(containsPoint(uShape, pt(0.5, 1))).toBe(true);
      // Inside right leg at (2.5, 1)
      expect(containsPoint(uShape, pt(2.5, 1))).toBe(true);
      // Inside bottom at (1.5, 0.5)
      expect(containsPoint(uShape, pt(1.5, 0.5))).toBe(true);
    });
  });

  describe('translate', () => {
    it('translates all vertices', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      const moved = translate(tri, 3, 4);
      expect(equals(moved.vertices[0], pt(3, 4))).toBe(true);
      expect(equals(moved.vertices[1], pt(4, 4))).toBe(true);
      expect(equals(moved.vertices[2], pt(3, 5))).toBe(true);
    });

    it('does not modify original', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      translate(tri, 5, 5);
      expect(equals(tri.vertices[0], pt(0, 0))).toBe(true);
    });
  });

  describe('rotate', () => {
    it('rotate square 90° around origin', () => {
      const sq = create([pt(1, 0), pt(2, 0), pt(2, 1), pt(1, 1)]);
      const rotated = rotate(sq, PI / 2);
      // (1,0) -> (0,1), (2,0) -> (0,2), (2,1) -> (-1,2), (1,1) -> (-1,1)
      expect(abs(rotated.vertices[0].x)).toBeLessThan(1e-10);
      expect(abs(rotated.vertices[0].y - 1)).toBeLessThan(1e-10);
    });

    it('rotate around center preserves shape', () => {
      const sq = create([pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2)]);
      const center = pt(1, 1);
      const rotated = rotate(sq, PI / 2, center);
      // Rotating a square 90° around its center should produce same square
      expect(abs(area(rotated) - area(sq))).toBeLessThan(1e-10);
      expect(numVertices(rotated)).toBe(4);
    });

    it('rotate by 360° returns same vertices', () => {
      const sq = create([pt(1, 2), pt(3, 2), pt(3, 4), pt(1, 4)]);
      const rotated = rotate(sq, 2 * PI);
      for (let i = 0; i < 4; i++) {
        expect(equals(rotated.vertices[i], sq.vertices[i])).toBe(true);
      }
    });
  });

  describe('scale', () => {
    it('uniform scale around origin', () => {
      const tri = create([pt(1, 0), pt(2, 0), pt(1, 1)]);
      const scaled = scale(tri, 2, 2);
      expect(equals(scaled.vertices[0], pt(2, 0))).toBe(true);
      expect(equals(scaled.vertices[1], pt(4, 0))).toBe(true);
      expect(equals(scaled.vertices[2], pt(2, 2))).toBe(true);
    });

    it('non-uniform scale', () => {
      const sq = create([pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2)]);
      const scaled = scale(sq, 3, 1);
      expect(equals(scaled.vertices[0], pt(0, 0))).toBe(true);
      expect(equals(scaled.vertices[1], pt(6, 0))).toBe(true);
      expect(equals(scaled.vertices[2], pt(6, 2))).toBe(true);
      expect(equals(scaled.vertices[3], pt(0, 2))).toBe(true);
    });

    it('scale around center', () => {
      const sq = create([pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2)]);
      const center = pt(1, 1);
      const scaled = scale(sq, 2, 2, center);
      // Each vertex moves away from center by factor 2
      expect(equals(scaled.vertices[0], pt(-1, -1))).toBe(true);
      expect(equals(scaled.vertices[1], pt(3, -1))).toBe(true);
      expect(equals(scaled.vertices[2], pt(3, 3))).toBe(true);
      expect(equals(scaled.vertices[3], pt(-1, 3))).toBe(true);
    });

    it('does not modify original', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      scale(tri, 2, 2);
      expect(equals(tri.vertices[0], pt(0, 0))).toBe(true);
    });
  });

  describe('clone', () => {
    it('creates independent copy', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      const copy = clone(tri);
      expect(equals(copy.vertices[0], tri.vertices[0])).toBe(true);
      expect(equals(copy.vertices[1], tri.vertices[1])).toBe(true);
      expect(equals(copy.vertices[2], tri.vertices[2])).toBe(true);
    });

    it('clone is deep copy', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      const copy = clone(tri);
      expect(copy.vertices).not.toBe(tri.vertices);
      expect(copy.vertices[0]).not.toBe(tri.vertices[0]);
      expect(equals(copy.vertices[0], tri.vertices[0])).toBe(true);
    });
  });

  describe('edges', () => {
    it('triangle has 3 edges', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      const e = edges(tri);
      expect(e).toHaveLength(3);
    });

    it('square has 4 edges', () => {
      const sq = create([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)]);
      const e = edges(sq);
      expect(e).toHaveLength(4);
    });

    it('edges are correct', () => {
      const tri = create([pt(0, 0), pt(1, 0), pt(0, 1)]);
      const e = edges(tri);
      expect(equals(e[0].from, pt(0, 0))).toBe(true);
      expect(equals(e[0].to, pt(1, 0))).toBe(true);
      expect(equals(e[1].from, pt(1, 0))).toBe(true);
      expect(equals(e[1].to, pt(0, 1))).toBe(true);
      expect(equals(e[2].from, pt(0, 1))).toBe(true);
      expect(equals(e[2].to, pt(0, 0))).toBe(true);
    });
  });

  describe('perimeter', () => {
    it('unit square perimeter is 4', () => {
      const sq = create([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)]);
      expect(abs(perimeter(sq) - 4)).toBeLessThan(1e-10);
    });

    it('3-4-5 triangle perimeter is 12', () => {
      const tri = create([pt(0, 0), pt(3, 0), pt(0, 4)]);
      expect(abs(perimeter(tri) - 12)).toBeLessThan(1e-10);
    });
  });

  describe('numVertices', () => {
    it('returns vertex count', () => {
      expect(numVertices(create([pt(0, 0), pt(1, 0), pt(0, 1)]))).toBe(3);
      expect(numVertices(create([pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)]))).toBe(4);
    });
  });
});
