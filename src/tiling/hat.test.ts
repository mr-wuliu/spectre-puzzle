import { describe, it, expect } from 'vitest';
import {
  hexPt,
  hatOutline,
  getInitialMetatileShapes,
  performSubstitution,
  countHatsAfterSubstitution,
  generateHatTiling,
} from './hat';
import type { Point } from '../geometry/point';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';

const EPS = 1e-6;

function ptEq(a: Point, b: Point, eps = EPS): boolean {
  return point.equals(a, b, eps);
}

describe('hexPt', () => {
  it('maps (1, 0) to (1, 0)', () => {
    const p = hexPt(1, 0);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('maps (0, 1) to (0.5, √3/2)', () => {
    const p = hexPt(0, 1);
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(Math.sqrt(3) / 2, 6);
  });

  it('maps (-1, -1) to (-1.5, -√3/2)', () => {
    const p = hexPt(-1, -1);
    expect(p.x).toBeCloseTo(-1.5, 6);
    expect(p.y).toBeCloseTo(-Math.sqrt(3) / 2, 6);
  });

  it('maps (0, 0) to origin', () => {
    const p = hexPt(0, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('maps (2, -2) to (1, -√3)', () => {
    const p = hexPt(2, -2);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(-Math.sqrt(3), 6);
  });
});

describe('hatOutline', () => {
  it('has exactly 13 vertices', () => {
    const outline = hatOutline();
    expect(outline.length).toBe(13);
  });

  it('first vertex is hexPt(0, 0) = origin', () => {
    const outline = hatOutline();
    expect(ptEq(outline[0], { x: 0, y: 0 })).toBe(true);
  });

  it('last vertex is hexPt(-1, 2) = (-0, √3)', () => {
    const outline = hatOutline();
    const expected = hexPt(-1, 2);
    expect(ptEq(outline[12], expected)).toBe(true);
  });

  it('vertex 4 is hexPt(2, -1)', () => {
    const outline = hatOutline();
    const expected = hexPt(2, -1);
    expect(ptEq(outline[4], expected)).toBe(true);
  });

  it('vertex 7 is hexPt(4, 0)', () => {
    const outline = hatOutline();
    const expected = hexPt(4, 0);
    expect(ptEq(outline[7], expected)).toBe(true);
  });

  it('all vertices are distinct', () => {
    const outline = hatOutline();
    for (let i = 0; i < outline.length; i++) {
      for (let j = i + 1; j < outline.length; j++) {
        expect(point.equals(outline[i], outline[j], EPS)).toBe(false);
      }
    }
  });

  it('has positive area (shoelace)', () => {
    const outline = hatOutline();
    const poly = polygon.create(outline);
    expect(polygon.area(poly)).toBeGreaterThan(0);
  });
});

describe('initial metatiles', () => {
  it('H has 6 outline vertices (hexagon)', () => {
    const shapes = getInitialMetatileShapes();
    const h = shapes.find(s => s.type === 'H')!;
    expect(h.outline.length).toBe(6);
  });

  it('T has 3 outline vertices (triangle)', () => {
    const shapes = getInitialMetatileShapes();
    const t = shapes.find(s => s.type === 'T')!;
    expect(t.outline.length).toBe(3);
  });

  it('P has 4 outline vertices (parallelogram)', () => {
    const shapes = getInitialMetatileShapes();
    const p = shapes.find(s => s.type === 'P')!;
    expect(p.outline.length).toBe(4);
  });

  it('F has 5 outline vertices (trapezoid)', () => {
    const shapes = getInitialMetatileShapes();
    const f = shapes.find(s => s.type === 'F')!;
    expect(f.outline.length).toBe(5);
  });

  it('H has 4 children', () => {
    const shapes = getInitialMetatileShapes();
    const h = shapes.find(s => s.type === 'H')!;
    expect(h.childCount).toBe(4);
  });

  it('T has 1 child', () => {
    const shapes = getInitialMetatileShapes();
    const t = shapes.find(s => s.type === 'T')!;
    expect(t.childCount).toBe(1);
  });

  it('P has 2 children', () => {
    const shapes = getInitialMetatileShapes();
    const p = shapes.find(s => s.type === 'P')!;
    expect(p.childCount).toBe(2);
  });

  it('F has 2 children', () => {
    const shapes = getInitialMetatileShapes();
    const f = shapes.find(s => s.type === 'F')!;
    expect(f.childCount).toBe(2);
  });
});

describe('substitution', () => {
  it('constructPatch produces 29 children', () => {
    const result = performSubstitution();
    expect(result.patchChildCount).toBe(29);
  });

  it('constructMetatiles produces 4 new metatiles', () => {
    const result = performSubstitution();
    expect(result.metatileShapes.length).toBe(4);
    const types = result.metatileShapes.map(s => s.type);
    expect(types).toContain('H');
    expect(types).toContain('T');
    expect(types).toContain('P');
    expect(types).toContain('F');
  });

  it('new H has 10 children', () => {
    const result = performSubstitution();
    const h = result.metatileShapes.find(s => s.type === 'H')!;
    expect(h.childCount).toBe(10);
  });

  it('new T has 1 child', () => {
    const result = performSubstitution();
    const t = result.metatileShapes.find(s => s.type === 'T')!;
    expect(t.childCount).toBe(1);
  });

  it('new P has 5 children', () => {
    const result = performSubstitution();
    const p = result.metatileShapes.find(s => s.type === 'P')!;
    expect(p.childCount).toBe(5);
  });

  it('new F has 6 children', () => {
    const result = performSubstitution();
    const f = result.metatileShapes.find(s => s.type === 'F')!;
    expect(f.childCount).toBe(6);
  });

  it('1 round of substitution produces 59 hats total across all metatiles', () => {
    expect(countHatsAfterSubstitution(1)).toBe(59);
  });

  it('2 rounds of substitution produces more hats than 1 round', () => {
    const n1 = countHatsAfterSubstitution(1);
    const n2 = countHatsAfterSubstitution(2);
    expect(n2).toBeGreaterThan(n1);
  });

  it('0 rounds gives initial hat count', () => {
    expect(countHatsAfterSubstitution(0)).toBe(9);
  });
});

describe('generateHatTiling', () => {
  it('returns tiles with correct structure', () => {
    const tiles = generateHatTiling(50, 50, 2);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.type).toMatch(/^hat(-reflected)?$/);
      expect(tile.polygon.vertices.length).toBe(13);
      expect(tile.transform.matrix.length).toBe(9);
    }
  });

  it('produces tiles within the bounding region', () => {
    const width = 30;
    const height = 30;
    const tiles = generateHatTiling(width, height, 2);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      const bb = polygon.boundingBox(tile.polygon);
      expect(bb.max.x).toBeGreaterThanOrEqual(-width / 2 - 1);
      expect(bb.min.x).toBeLessThanOrEqual(width / 2 + 1);
    }
  });

  it('more depth produces more tiles', () => {
    const tiles1 = generateHatTiling(50, 50, 1);
    const tiles2 = generateHatTiling(50, 50, 2);
    expect(tiles2.length).toBeGreaterThan(tiles1.length);
  });

  it('tiles have non-zero area', () => {
    const tiles = generateHatTiling(50, 50, 2);
    let totalArea = 0;
    for (const tile of tiles) {
      const a = polygon.area(tile.polygon);
      expect(a).not.toBeCloseTo(0, 4);
      totalArea += Math.abs(a);
    }
    expect(totalArea).toBeGreaterThan(0);
  });

  it('tiles include both hat and hat-reflected types', () => {
    const tiles = generateHatTiling(100, 100, 2);
    const types = new Set(tiles.map(t => t.type));
    expect(types.has('hat')).toBe(true);
    expect(types.has('hat-reflected')).toBe(true);
  });
});
