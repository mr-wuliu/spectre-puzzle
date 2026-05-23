import { describe, it, expect } from 'vitest';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';
import {
  SPECTRE_VERTICES,
  METATILE_TYPES,
  SUPER_RULES,
  buildSpectreBase,
  buildSupertiles,
  flattenTiles,
  generateSpectreTiling,
  type MetatileNode,
  type MetatileType,
} from './spectre';

describe('Spectre Tile', () => {
  describe('Base Vertices', () => {
    it('should have exactly 14 vertices', () => {
      expect(SPECTRE_VERTICES.length).toBe(14);
    });

    it('should match known coordinates within epsilon 1e-6', () => {
      const S = Math.sqrt(3) / 2;
      const expected: { x: number; y: number }[] = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1.5, y: -S },
        { x: 1.5 + S, y: 0.5 - S },
        { x: 1.5 + S, y: 1.5 - S },
        { x: 2.5 + S, y: 1.5 - S },
        { x: 3 + S, y: 1.5 },
        { x: 3, y: 2 },
        { x: 3 - S, y: 1.5 },
        { x: 2.5 - S, y: 1.5 + S },
        { x: 1.5 - S, y: 1.5 + S },
        { x: 0.5 - S, y: 1.5 + S },
        { x: -S, y: 1.5 },
        { x: 0, y: 1 },
      ];

      for (let i = 0; i < 14; i++) {
        expect(SPECTRE_VERTICES[i].x).toBeCloseTo(expected[i].x, 6);
        expect(SPECTRE_VERTICES[i].y).toBeCloseTo(expected[i].y, 6);
      }
    });

    it('should have all 14 edges of length 1.0 within epsilon 1e-4', () => {
      const poly = polygon.create(SPECTRE_VERTICES.map(v => ({ x: v.x, y: v.y })));
      const edgeList = polygon.edges(poly);

      expect(edgeList.length).toBe(14);

      for (const edge of edgeList) {
        const len = point.distance(edge.from, edge.to);
        expect(len).toBeCloseTo(1.0, 4);
      }
    });
  });

  describe('Metatile Base System', () => {
    it('should have 9 metatile types', () => {
      expect(METATILE_TYPES.length).toBe(9);
    });

    it('should build spectre base with all 9 types', () => {
      const base = buildSpectreBase();
      for (const type of METATILE_TYPES) {
        expect(base[type]).toBeDefined();
      }
    });

    it('should have Gamma as composite with 2 children in spectre base', () => {
      const base = buildSpectreBase();
      const gamma = base['Gamma'];
      expect(gamma.kind).toBe('composite');
      if (gamma.kind === 'composite') {
        expect(gamma.children.length).toBe(2);
      }
    });

    it('should have all non-Gamma types as leaves with 14 vertices', () => {
      const base = buildSpectreBase();
      const simpleTypes: MetatileType[] = ['Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi'];
      for (const type of simpleTypes) {
        const node = base[type];
        expect(node.kind).toBe('leaf');
        if (node.kind === 'leaf') {
          expect(node.vertices.length).toBe(14);
        }
      }
    });
  });

  describe('Metatile Substitution Rules', () => {
    it('should define substitution rules for all 9 types', () => {
      for (const type of METATILE_TYPES) {
        expect(SUPER_RULES[type]).toBeDefined();
        expect(SUPER_RULES[type].length).toBe(8);
      }
    });

    it('should produce correct children counts after one substitution', () => {
      const base = buildSpectreBase();
      const superSys = buildSupertiles(base);

      for (const type of METATILE_TYPES) {
        const node = superSys[type];
        expect(node.kind).toBe('composite');
        if (node.kind === 'composite') {
          const rules = SUPER_RULES[type];
          const expectedCount = rules.filter((r): r is MetatileType => r !== null).length;
          expect(node.children.length).toBe(expectedCount);
        }
      }
    });

    it('should produce children whose labels match substitution rules', () => {
      const base = buildSpectreBase();
      const superSys = buildSupertiles(base);

      for (const type of METATILE_TYPES) {
        const node = superSys[type];
        if (node.kind === 'composite') {
          const rules = SUPER_RULES[type];
          const expectedLabels = rules.filter((r): r is MetatileType => r !== null);
          const childLabels = node.children.map(c => c.node.label);
          expect(childLabels).toEqual(expectedLabels);
        }
      }
    });

    it('should have Gamma with 7 children (one null slot skipped)', () => {
      const base = buildSpectreBase();
      const superSys = buildSupertiles(base);
      const gamma = superSys['Gamma'];
      if (gamma.kind === 'composite') {
        expect(gamma.children.length).toBe(7);
      }
    });

    it('should have all non-Gamma types with 8 children', () => {
      const base = buildSpectreBase();
      const superSys = buildSupertiles(base);
      const nonGamma: MetatileType[] = ['Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi'];
      for (const type of nonGamma) {
        const node = superSys[type];
        if (node.kind === 'composite') {
          expect(node.children.length).toBe(8);
        }
      }
    });
  });

  describe('Flatten Tiles', () => {
    it('should flatten a leaf node to a single tile', () => {
      const base = buildSpectreBase();
      const delta = base['Delta'];
      const tiles = flattenTiles(delta, transform.identity());
      expect(tiles.length).toBe(1);
      expect(tiles[0].type).toBe('spectre');
      expect(tiles[0].polygon.vertices.length).toBe(14);
    });

    it('should flatten Gamma base to 2 tiles', () => {
      const base = buildSpectreBase();
      const gamma = base['Gamma'];
      const tiles = flattenTiles(gamma, transform.identity());
      expect(tiles.length).toBe(2);
    });

    it('should flatten Delta at depth 1 to correct number of tiles', () => {
      const base = buildSpectreBase();
      const superSys = buildSupertiles(base);
      // Delta expands to: Xi, Delta, Xi, Phi, Sigma, Pi, Phi, Gamma
      // 7 single-tile types + Gamma(2 tiles) = 9
      const delta = superSys['Delta'];
      const tiles = flattenTiles(delta, transform.identity());
      expect(tiles.length).toBe(9);
    });
  });

  describe('generateSpectreTiling', () => {
    it('should return at least one tile at depth 0', () => {
      const tiles = generateSpectreTiling(10, 10, 0);
      expect(tiles.length).toBeGreaterThan(0);
    });

    it('should return tiles covering a region with positive total area', () => {
      const tiles = generateSpectreTiling(10, 10, 1);
      expect(tiles.length).toBeGreaterThan(0);

      let totalArea = 0;
      for (const tile of tiles) {
        const transformed = transform.applyToPolygon(tile.transform, tile.polygon);
        totalArea += Math.abs(polygon.area(transformed));
      }
      expect(totalArea).toBeGreaterThan(0);
    });

    it('should produce tiles with type spectre', () => {
      const tiles = generateSpectreTiling(10, 10, 1);
      for (const tile of tiles) {
        expect(tile.type).toBe('spectre');
      }
    });

    it('should produce more tiles at higher depth', () => {
      const tiles0 = generateSpectreTiling(10, 10, 0);
      const tiles1 = generateSpectreTiling(10, 10, 1);
      expect(tiles1.length).toBeGreaterThan(tiles0.length);
    });
  });

  describe('Chirality', () => {
    it('should use the same base polygon for all tiles (no reflections of the shape)', () => {
      const tiles = generateSpectreTiling(10, 10, 1);
      expect(tiles.length).toBeGreaterThan(0);

      for (const tile of tiles) {
        expect(tile.polygon.vertices.length).toBe(14);
        for (let i = 0; i < 14; i++) {
          expect(tile.polygon.vertices[i].x).toBeCloseTo(SPECTRE_VERTICES[i].x, 10);
          expect(tile.polygon.vertices[i].y).toBeCloseTo(SPECTRE_VERTICES[i].y, 10);
        }
      }
    });

    it('should have consistent signed area magnitude across all tiles', () => {
      const tiles = generateSpectreTiling(10, 10, 1);
      const baseArea = Math.abs(polygon.area(
        polygon.create(SPECTRE_VERTICES.map(v => ({ x: v.x, y: v.y })))
      ));

      for (const tile of tiles) {
        const transformed = transform.applyToPolygon(tile.transform, tile.polygon);
        const area = Math.abs(polygon.area(transformed));
        // All tiles should have the same area magnitude (same shape, just positioned differently)
        expect(area).toBeCloseTo(baseArea, 4);
      }
    });
  });
});
