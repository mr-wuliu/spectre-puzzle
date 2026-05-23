/**
 * Integration tests for Spectre Puzzle — cross-module roundtrip and edge case coverage.
 *
 * Tests the FULL flow: generate tiling → create pieces → export → import → verify,
 * plus snap/merge/win flows, curved edges, polygon clipping, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import * as point from './geometry/point';
import * as polygon from './geometry/polygon';
import * as transform from './geometry/transform';
import { clipPolygon, isEmptyPolygon } from './geometry/clip';
import type { ClipRect } from './geometry/clip';
import * as hat from './tiling/hat';
import * as spectre from './tiling/spectre';
import { createCurvyShape } from './tiling/curved';
import type { CurvyShape } from './tiling/curved';
import { createPiece, canSnapTo, mergePieces } from './puzzle/piece';
import type { Piece, SnapResult } from './puzzle/piece';
import { createPuzzleModel, checkWin, getPieceAt } from './puzzle/puzzle-model';
import type { PuzzleModel } from './puzzle/puzzle-model';
import { exportPuzzle, importPuzzle } from './puzzle/serialize';
import { findSnapTarget, applySnap } from './puzzle/snap';
import { checkWinCondition } from './puzzle/win';
import type { WinResult } from './puzzle/win';

// ─── Helpers ──────────────────────────────────────────────────────

/** Create a simple unit square polygon (CCW). */
function unitSquare(): polygon.Polygon {
  return polygon.create([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
}

/** Create a unit triangle polygon (CCW). */
function unitTriangle(): polygon.Polygon {
  return polygon.create([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0.5, y: Math.sqrt(3) / 2 },
  ]);
}

/**
 * Assign side IDs to tiles from a tiling result.
 * For hat tiles (13 sides), spectre tiles (14 sides).
 * Adjacent tiles share complementary IDs. This simplified version assigns
 * unique positive IDs per tile edge; proper adjacency detection would
 * require spatial hashing (used only for snap test setup).
 */
function assignSideIds(tileCount: number, sidesPerTile: number): number[][] {
  const allIds: number[][] = [];
  for (let t = 0; t < tileCount; t++) {
    const ids: number[] = [];
    for (let s = 0; s < sidesPerTile; s++) {
      // Each edge gets a unique positive ID; frame edges get 0
      ids.push(t * sidesPerTile + s + 1);
    }
    allIds.push(ids);
  }
  return allIds;
}

/** Create pieces from hat tiling tiles. */
function createHatPieces(
  tiles: hat.Tile[],
  sideIdAssignments: number[][],
): Piece[] {
  return tiles.map((tile, i) => {
    const n = polygon.numVertices(tile.polygon);
    const ids = sideIdAssignments[i] ?? Array(n).fill(0);
    return createPiece(i, tile.polygon, tile.transform, ids, i === 0);
  });
}

/** Create pieces from spectre tiling tiles. */
function createSpectrePieces(
  tiles: spectre.Tile[],
  sideIdAssignments: number[][],
): Piece[] {
  return tiles.map((tile, i) => {
    const n = polygon.numVertices(tile.polygon);
    const ids = sideIdAssignments[i] ?? Array(n).fill(0);
    return createPiece(i, tile.polygon, tile.transform, ids, i === 0);
  });
}

/**
 * Create two adjacent pieces with complementary side IDs for snap testing.
 * Two unit squares sharing one edge.
 */
function createAdjacentSquarePieces(): { pieceA: Piece; pieceB: Piece; sharedSideIdxA: number; sharedSideIdxB: number } {
  const polyA = unitSquare();
  const polyB = polygon.create([
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
  ]);

  // Side IDs: edge index 1 of A (top) matches edge index 3 of B (bottom) with complementary IDs
  // Edge 1 of A: (1,0)→(1,1) — right side
  // Edge 3 of B: (1,1)→(1,0) — left side, reversed direction
  // For snap: sideA.id + sideB.id === 0, and sideA.ptA ≈ sideB.ptB, sideA.ptB ≈ sideB.ptA
  // Edge 1 of A goes (1,0)→(1,1); Edge 3 of B goes (1,1)→(1,0) — reversed!
  // So sideA.ptA=(1,0) ≈ sideB.ptB=(1,0) ✓ and sideA.ptB=(1,1) ≈ sideB.ptA=(1,1) ✓
  const sideIdsA = [1, 5, 2, 3]; // edge 1 has id=5
  const sideIdsB = [4, 6, 7, -5]; // edge 3 has id=-5 (complementary to 5)

  const pieceA = createPiece(0, polyA, transform.identity(), sideIdsA, false);
  const pieceB = createPiece(1, polyB, transform.identity(), sideIdsB, false);

  return { pieceA, pieceB, sharedSideIdxA: 1, sharedSideIdxB: 3 };
}

// ─── Hat tiling roundtrip ─────────────────────────────────────────

describe('Hat tiling roundtrip', () => {
  it('generates tiles at depth 0 and creates valid pieces', () => {
    const tiles = hat.generateHatTiling(50, 50, 0);
    expect(tiles.length).toBeGreaterThan(0);

    for (const tile of tiles) {
      expect(polygon.numVertices(tile.polygon)).toBe(13);
      expect(tile.type).toMatch(/^hat(-reflected)?$/);
      expect(tile.transform.matrix.length).toBe(9);
    }

    const sideIds = assignSideIds(tiles.length, 13);
    const pieces = createHatPieces(tiles, sideIds);
    expect(pieces.length).toBe(tiles.length);

    for (const piece of pieces) {
      expect(piece.sides.length).toBe(13);
      expect(piece.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('exports and imports hat puzzle preserving all piece data', () => {
    const tiles = hat.generateHatTiling(50, 50, 0);
    const sideIds = assignSideIds(tiles.length, 13);
    const pieces = createHatPieces(tiles, sideIds);

    // Build frame polygon from first tile (enlarged)
    const firstPoly = tiles[0].polygon;
    const bb = polygon.boundingBox(firstPoly);
    const framePolygon = polygon.create([
      { x: bb.min.x - 5, y: bb.min.y - 5 },
      { x: bb.max.x + 5, y: bb.min.y - 5 },
      { x: bb.max.x + 5, y: bb.max.y + 5 },
      { x: bb.min.x - 5, y: bb.max.y + 5 },
    ]);

    const model = createPuzzleModel(pieces, framePolygon);
    const json = exportPuzzle(model, 'hat', true);
    const restored = importPuzzle(json);

    expect(restored.pieces.length).toBe(pieces.length);
    expect(restored.framePolygon.vertices.length).toBe(4);

    for (let i = 0; i < pieces.length; i++) {
      const orig = pieces[i];
      const rest = restored.pieces[i];
      expect(rest.id).toBe(orig.id);
      expect(rest.polygon.vertices.length).toBe(orig.polygon.vertices.length);
      expect(rest.sides.length).toBe(orig.sides.length);
      expect(rest.isFramePiece).toBe(orig.isFramePiece);

      // Verify polygon vertices preserved
      for (let v = 0; v < orig.polygon.vertices.length; v++) {
        expect(rest.polygon.vertices[v].x).toBeCloseTo(orig.polygon.vertices[v].x, 10);
        expect(rest.polygon.vertices[v].y).toBeCloseTo(orig.polygon.vertices[v].y, 10);
      }

      // Verify side IDs preserved
      for (let s = 0; s < orig.sides.length; s++) {
        expect(rest.sides[s].id).toBe(orig.sides[s].id);
      }

      // Verify transform preserved
      for (let m = 0; m < 9; m++) {
        expect(rest.transform.matrix[m]).toBeCloseTo(orig.transform.matrix[m], 10);
      }
    }
  });
});

// ─── Spectre tiling roundtrip ─────────────────────────────────────

describe('Spectre tiling roundtrip', () => {
  it('generates tiles at depth 0 and creates valid pieces', () => {
    const tiles = spectre.generateSpectreTiling(50, 50, 0);
    expect(tiles.length).toBeGreaterThan(0);

    for (const tile of tiles) {
      expect(polygon.numVertices(tile.polygon)).toBe(14);
      expect(tile.type).toBe('spectre');
    }

    const sideIds = assignSideIds(tiles.length, 14);
    const pieces = createSpectrePieces(tiles, sideIds);
    expect(pieces.length).toBe(tiles.length);
  });

  it('exports and imports spectre puzzle preserving all piece data', () => {
    const tiles = spectre.generateSpectreTiling(50, 50, 0);
    const sideIds = assignSideIds(tiles.length, 14);
    const pieces = createSpectrePieces(tiles, sideIds);

    const firstPoly = tiles[0].polygon;
    const bb = polygon.boundingBox(firstPoly);
    const framePolygon = polygon.create([
      { x: bb.min.x - 5, y: bb.min.y - 5 },
      { x: bb.max.x + 5, y: bb.min.y - 5 },
      { x: bb.max.x + 5, y: bb.max.y + 5 },
      { x: bb.min.x - 5, y: bb.max.y + 5 },
    ]);

    const model = createPuzzleModel(pieces, framePolygon);
    const json = exportPuzzle(model, 'spectre', true);
    const restored = importPuzzle(json);

    expect(restored.pieces.length).toBe(pieces.length);
    expect(restored.framePolygon.vertices.length).toBe(4);

    for (let i = 0; i < pieces.length; i++) {
      const orig = pieces[i];
      const rest = restored.pieces[i];
      expect(rest.id).toBe(orig.id);
      expect(rest.polygon.vertices.length).toBe(orig.polygon.vertices.length);
      expect(rest.sides.length).toBe(orig.sides.length);
      expect(rest.isFramePiece).toBe(orig.isFramePiece);

      // Verify side IDs preserved
      for (let s = 0; s < orig.sides.length; s++) {
        expect(rest.sides[s].id).toBe(orig.sides[s].id);
      }

      // Verify transform preserved
      for (let m = 0; m < 9; m++) {
        expect(rest.transform.matrix[m]).toBeCloseTo(orig.transform.matrix[m], 10);
      }
    }
  });

  it('preserves solution map through serialization roundtrip', () => {
    const tiles = spectre.generateSpectreTiling(50, 50, 0);
    const sideIds = assignSideIds(tiles.length, 14);
    const pieces = createSpectrePieces(tiles, sideIds);

    const framePolygon = polygon.create([
      { x: -10, y: -10 }, { x: 20, y: -10 },
      { x: 20, y: 20 }, { x: -10, y: 20 },
    ]);

    const solutionMap = new Map<number, transform.AffineTransform>();
    solutionMap.set(0, transform.translation(1, 2));
    solutionMap.set(1, transform.rotation(Math.PI / 6));

    const model = createPuzzleModel(pieces, framePolygon, solutionMap);
    const json = exportPuzzle(model, 'spectre', false);
    const restored = importPuzzle(json);

    expect(restored.solutionMap.size).toBe(2);
    expect(restored.solutionMap.has(0)).toBe(true);
    expect(restored.solutionMap.has(1)).toBe(true);

    const sol0 = restored.solutionMap.get(0)!;
    expect(sol0.matrix[2]).toBeCloseTo(1, 10);
    expect(sol0.matrix[5]).toBeCloseTo(2, 10);
  });
});

// ─── Piece snap → merge → win check flow ──────────────────────────

describe('Piece snap → merge → win check flow', () => {
  it('detects snap between two adjacent pieces with complementary sides', () => {
    const { pieceA, pieceB } = createAdjacentSquarePieces();

    // Both pieces at identity transform, sharing edge at x=1
    const snap = canSnapTo(pieceA, pieceB, 8);
    expect(snap).not.toBeNull();
    expect(snap!.sideA.id + snap!.sideB.id).toBe(0);
    expect(point.magnitude(snap!.offset)).toBeLessThan(8);
  });

  it('merges two snapped pieces into a valid composite', () => {
    const { pieceA, pieceB } = createAdjacentSquarePieces();
    const snap = canSnapTo(pieceA, pieceB, 8);
    expect(snap).not.toBeNull();

    const merged = mergePieces(pieceA, pieceB, snap!, 100);
    expect(merged.id).toBe(100);
    // Two squares (4 sides each) minus 2 shared sides = 6 sides
    expect(merged.sides.length).toBe(6);
    expect(merged.polygon.vertices.length).toBe(6);
    // Merged piece should have identity transform (world coords)
    expect(transform.equals(merged.transform, transform.identity())).toBe(true);
  });

  it('performs full snap-merge via applySnap producing valid puzzle model', () => {
    const { pieceA, pieceB } = createAdjacentSquarePieces();
    const framePoly = polygon.create([
      { x: -1, y: -1 }, { x: 3, y: -1 },
      { x: 3, y: 2 }, { x: -1, y: 2 },
    ]);

    const model = createPuzzleModel([pieceA, pieceB], framePoly);
    expect(model.pieces.length).toBe(2);

    const snap = findSnapTarget(pieceA, model, 8);
    expect(snap).not.toBeNull();

    const newModel = applySnap(snap!, model, 200);
    expect(newModel.pieces.length).toBe(1);
    expect(newModel.pieces[0].id).toBe(200);
    expect(newModel.framePolygon).toBe(framePoly);
  });

  it('checks win condition: empty puzzle is trivially complete', () => {
    const framePoly = polygon.create([
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ]);
    const model = createPuzzleModel([], framePoly);
    const result = checkWinCondition(model);
    expect(result.isComplete).toBe(true);
    expect(result.allPlaced).toBe(true);
  });

  it('checks win condition: all placed pieces matching frame area', () => {
    const poly = unitSquare();
    // Frame must be slightly larger than piece (containsPoint winding number boundary issue)
    // but within 1% area tolerance (AREA_TOLERANCE = 0.01). ε=0.001 → area ratio ≈ 0.4%
    const framePoly = polygon.create([
      { x: -0.001, y: -0.001 }, { x: 1.001, y: -0.001 },
      { x: 1.001, y: 1.001 }, { x: -0.001, y: 1.001 },
    ]);
    const piece = createPiece(0, poly, transform.identity(), [1, 2, 3, 4], false);
    piece.isPlaced = true;

    const model = createPuzzleModel([piece], framePoly);
    const result = checkWinCondition(model);
    expect(result.allPlaced).toBe(true);
    expect(result.allInsideFrame).toBe(true);
    expect(result.areaMatch).toBe(true);
    expect(result.isComplete).toBe(true);
  });

  it('checks win condition: unplaced pieces report incomplete', () => {
    const poly = unitSquare();
    const framePoly = polygon.create([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 1 }, { x: 0, y: 1 },
    ]);
    const piece = createPiece(0, poly, transform.identity(), [1, 2, 3, 4], false);
    piece.isPlaced = false;

    const model = createPuzzleModel([piece], framePoly);
    const result = checkWinCondition(model);
    expect(result.isComplete).toBe(false);
    expect(result.allPlaced).toBe(false);
  });

  it('checkWin returns false when pieces are unplaced', () => {
    const poly = unitSquare();
    const framePoly = polygon.create([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 1 }, { x: 0, y: 1 },
    ]);
    const piece = createPiece(0, poly, transform.identity(), [1, 2, 3, 4], false);
    piece.isPlaced = false;

    const model = createPuzzleModel([piece], framePoly);
    expect(checkWin(model)).toBe(false);
  });

  it('checkWin returns true when all pieces are placed', () => {
    const poly = unitSquare();
    const framePoly = polygon.create([
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 1, y: 1 }, { x: 0, y: 1 },
    ]);
    const piece = createPiece(0, poly, transform.identity(), [1, 2, 3, 4], false);
    piece.isPlaced = true;

    const model = createPuzzleModel([piece], framePoly);
    expect(checkWin(model)).toBe(true);
  });

  it('getPieceAt finds the piece under a point', () => {
    const poly = polygon.create([
      { x: 0, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 2 }, { x: 0, y: 2 },
    ]);
    const piece = createPiece(0, poly, transform.identity(), [1, 2, 3, 4], false);
    const framePoly = polygon.create([
      { x: -5, y: -5 }, { x: 10, y: -5 },
      { x: 10, y: 10 }, { x: -5, y: 10 },
    ]);
    const model = createPuzzleModel([piece], framePoly);

    const found = getPieceAt(model, { x: 1, y: 1 });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(0);

    const notFound = getPieceAt(model, { x: 5, y: 5 });
    expect(notFound).toBeNull();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────

describe('Edge cases', () => {
  it('createPiece throws if sideIds length mismatches vertex count', () => {
    const poly = unitSquare();
    expect(() => createPiece(0, poly, transform.identity(), [1, 2], false))
      .toThrow('sideIds length (2) must match vertex count (4)');
  });

  it('canSnapTo returns null for non-adjacent pieces', () => {
    const polyA = unitSquare();
    const polyB = polygon.create([
      { x: 10, y: 10 }, { x: 11, y: 10 },
      { x: 11, y: 11 }, { x: 10, y: 11 },
    ]);
    const pieceA = createPiece(0, polyA, transform.identity(), [1, 2, 3, 4], false);
    const pieceB = createPiece(1, polyB, transform.identity(), [1, 2, 3, 4], false);

    const snap = canSnapTo(pieceA, pieceB, 8);
    expect(snap).toBeNull();
  });

  it('canSnapTo returns null for non-complementary side IDs', () => {
    const polyA = unitSquare();
    const polyB = polygon.create([
      { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 1, y: 1 },
    ]);
    // Both have positive IDs — no complementary pair
    const pieceA = createPiece(0, polyA, transform.identity(), [1, 2, 3, 4], false);
    const pieceB = createPiece(1, polyB, transform.identity(), [5, 6, 7, 8], false);

    const snap = canSnapTo(pieceA, pieceB, 8);
    expect(snap).toBeNull();
  });

  it('findSnapTarget returns null when no pieces can snap', () => {
    const poly = unitSquare();
    const pieceA = createPiece(0, poly, transform.identity(), [1, 2, 3, 4], false);
    const pieceB = createPiece(1, poly, transform.translation(10, 10), [5, 6, 7, 8], false);
    const framePoly = polygon.create([
      { x: -5, y: -5 }, { x: 20, y: -5 },
      { x: 20, y: 20 }, { x: -5, y: 20 },
    ]);
    const model = createPuzzleModel([pieceA, pieceB], framePoly);

    const snap = findSnapTarget(pieceA, model, 8);
    expect(snap).toBeNull();
  });

  it('single piece puzzle: win check works correctly', () => {
    const poly = unitSquare();
    const framePoly = polygon.create([
      { x: -0.001, y: -0.001 }, { x: 1.001, y: -0.001 },
      { x: 1.001, y: 1.001 }, { x: -0.001, y: 1.001 },
    ]);
    const piece = createPiece(0, poly, transform.identity(), [1, 2, 3, 4], false);
    piece.isPlaced = true;
    const model = createPuzzleModel([piece], framePoly);

    const result = checkWinCondition(model);
    expect(result.isComplete).toBe(true);
  });

  it('many pieces with degenerate transforms', () => {
    // Create pieces with various transforms (rotation, scaling, translation)
    const poly = unitTriangle();
    const pieces: Piece[] = [];
    for (let i = 0; i < 10; i++) {
      const xform = transform.compose(
        transform.translation(i * 2, i * 3),
        transform.rotation(i * 0.5),
      );
      const sideIds = [i * 4 + 1, i * 4 + 2, i * 4 + 3];
      pieces.push(createPiece(i, poly, xform, sideIds, i === 0));
    }

    const framePoly = polygon.create([
      { x: -5, y: -5 }, { x: 30, y: -5 },
      { x: 30, y: 40 }, { x: -5, y: 40 },
    ]);
    const model = createPuzzleModel(pieces, framePoly);
    const json = exportPuzzle(model, 'hat', false);
    const restored = importPuzzle(json);

    expect(restored.pieces.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      const orig = pieces[i];
      const rest = restored.pieces[i];
      expect(rest.isFramePiece).toBe(orig.isFramePiece);
      expect(rest.sides.length).toBe(3);
    }
  });

  it('polygon.create rejects less than 3 vertices', () => {
    expect(() => polygon.create([])).toThrow('at least 3 vertices');
    expect(() => polygon.create([{ x: 0, y: 0 }])).toThrow('at least 3 vertices');
    expect(() => polygon.create([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toThrow('at least 3 vertices');
  });
});

// ─── Deserialization error cases ──────────────────────────────────

describe('Deserialization error cases', () => {
  it('rejects invalid JSON', () => {
    expect(() => importPuzzle('not json at all')).toThrow('not valid JSON');
  });

  it('rejects missing version', () => {
    expect(() => importPuzzle('{}')).toThrow('missing or invalid "version" field');
  });

  it('rejects wrong version', () => {
    expect(() => importPuzzle('{"version":"2.0"}')).toThrow('Unsupported puzzle version: 2.0');
  });

  it('rejects missing frame', () => {
    expect(() => importPuzzle('{"version":"1.0"}')).toThrow('frame');
  });

  it('rejects missing pieces array', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('pieces');
  });

  it('rejects piece with non-numeric id', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      pieces: [{
        id: 'not-a-number',
        polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
        initialTransform: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        sideIds: [1, 2, 3, 4],
        isFramePiece: false,
      }],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('pieces[0].id must be a number');
  });

  it('rejects piece with wrong transform matrix size', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      pieces: [{
        id: 0,
        polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
        initialTransform: { matrix: [1, 0, 0, 0, 1, 0] },
        sideIds: [1, 2, 3, 4],
        isFramePiece: false,
      }],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('transform.matrix must be 9 numbers');
  });

  it('rejects piece with missing isFramePiece', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      pieces: [{
        id: 0,
        polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
        initialTransform: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        sideIds: [1, 2, 3, 4],
        isFramePiece: 'yes',
      }],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('pieces[0].isFramePiece must be a boolean');
  });
});

// ─── Curved edge creation + straighten roundtrip ──────────────────

describe('Curved edge creation + straighten roundtrip', () => {
  it('creates curvy shape from hat polygon with correct segment count', () => {
    const tiles = hat.generateHatTiling(50, 50, 0);
    expect(tiles.length).toBeGreaterThan(0);

    const curvy = createCurvyShape(tiles[0].polygon);
    // Hat has 13 vertices → 13 edges → 13 Bézier segments
    expect(curvy.segments.length).toBe(13);
    expect(curvy.originalPolygon.vertices.length).toBe(13);
  });

  it('creates curvy shape from spectre polygon with correct segment count', () => {
    const tiles = spectre.generateSpectreTiling(50, 50, 0);
    expect(tiles.length).toBeGreaterThan(0);

    const curvy = createCurvyShape(tiles[0].polygon);
    // Spectre has 14 vertices → 14 edges → 14 Bézier segments
    expect(curvy.segments.length).toBe(14);
    expect(curvy.originalPolygon.vertices.length).toBe(14);
  });

  it('straighten returns original polygon vertices', () => {
    const poly = unitSquare();
    const curvy = createCurvyShape(poly);
    const straightened = curvy.straighten();

    expect(straightened.vertices.length).toBe(poly.vertices.length);
    for (let i = 0; i < poly.vertices.length; i++) {
      expect(straightened.vertices[i].x).toBeCloseTo(poly.vertices[i].x, 10);
      expect(straightened.vertices[i].y).toBeCloseTo(poly.vertices[i].y, 10);
    }
  });

  it('curvy segments have control points offset from edge', () => {
    const poly = unitSquare();
    const curvy = createCurvyShape(poly);

    for (let i = 0; i < curvy.segments.length; i++) {
      const seg = curvy.segments[i];
      // Control points should differ from edge endpoints (offset applied)
      expect(point.equals(seg.cp1, seg.from)).toBe(false);
      expect(point.equals(seg.cp2, seg.to)).toBe(false);
      // Segment endpoints match polygon vertices
      expect(point.equals(seg.from, poly.vertices[i])).toBe(true);
      expect(point.equals(seg.to, poly.vertices[(i + 1) % poly.vertices.length])).toBe(true);
    }
  });

  it('curvy shape from triangle has 3 segments', () => {
    const poly = unitTriangle();
    const curvy = createCurvyShape(poly);
    expect(curvy.segments.length).toBe(3);
  });
});

// ─── Polygon clipping ─────────────────────────────────────────────

describe('Polygon clipping with concave shapes', () => {
  it('clips a hat polygon to a containing rect (no change)', () => {
    const tiles = hat.generateHatTiling(100, 100, 0);
    expect(tiles.length).toBeGreaterThan(0);

    const tilePoly = tiles[0].polygon;
    const bb = polygon.boundingBox(tilePoly);
    const rect: ClipRect = {
      minX: bb.min.x - 10,
      minY: bb.min.y - 10,
      maxX: bb.max.x + 10,
      maxY: bb.max.y + 10,
    };

    const clipped = clipPolygon(tilePoly, rect);
    expect(clipped.vertices.length).toBe(tilePoly.vertices.length);
  });

  it('clips a spectre polygon partially outside rect', () => {
    const tiles = spectre.generateSpectreTiling(100, 100, 0);
    expect(tiles.length).toBeGreaterThan(0);

    const tilePoly = tiles[0].polygon;
    const bb = polygon.boundingBox(tilePoly);
    // Clip rect cuts through the middle of the tile
    const midX = (bb.min.x + bb.max.x) / 2;
    const rect: ClipRect = {
      minX: midX,
      minY: bb.min.y - 10,
      maxX: bb.max.x + 10,
      maxY: bb.max.y + 10,
    };

    const clipped = clipPolygon(tilePoly, rect);
    expect(clipped.vertices.length).toBeGreaterThanOrEqual(3);
    expect(clipped.vertices.length).toBeLessThanOrEqual(tilePoly.vertices.length + 2);
  });

  it('clips polygon fully outside rect to empty', () => {
    const poly = unitSquare();
    const rect: ClipRect = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
    const clipped = clipPolygon(poly, rect);
    expect(isEmptyPolygon(clipped)).toBe(true);
  });

  it('clips a concave polygon correctly', () => {
    // Arrow/chevron shape (concave)
    const concave = polygon.create([
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 0.5, y: 1 }, // concavity
    ]);
    const rect: ClipRect = { minX: -1, minY: -1, maxX: 1, maxY: 3 };
    const clipped = clipPolygon(concave, rect);
    expect(clipped.vertices.length).toBeGreaterThanOrEqual(3);
  });

  it('handles degenerate clip (rect fully outside polygon)', () => {
    const poly = unitSquare();
    const rect: ClipRect = { minX: 5, minY: 5, maxX: 6, maxY: 6 };
    const clipped = clipPolygon(poly, rect);
    expect(isEmptyPolygon(clipped)).toBe(true);
  });
});

// ─── Transform composition integrity ──────────────────────────────

describe('Transform composition integrity', () => {
  it('identity composed with any transform equals that transform', () => {
    const rot = transform.rotation(Math.PI / 4);
    const trans = transform.translation(3, 7);
    const scale = transform.scaling(2, 0.5);

    expect(transform.equals(transform.compose(transform.identity(), rot), rot)).toBe(true);
    expect(transform.equals(transform.compose(transform.identity(), trans), trans)).toBe(true);
    expect(transform.equals(transform.compose(transform.identity(), scale), scale)).toBe(true);
  });

  it('compose(A, inverse(A)) equals identity', () => {
    const xform = transform.compose(
      transform.translation(5, 3),
      transform.rotation(Math.PI / 6),
    );
    const result = transform.compose(xform, transform.inverse(xform));
    expect(transform.equals(result, transform.identity())).toBe(true);
  });

  it('applyToPolygon then inverse recovers original vertices', () => {
    const poly = unitSquare();
    const xform = transform.compose(
      transform.translation(10, 20),
      transform.rotation(Math.PI / 3),
    );
    const transformed = transform.applyToPolygon(xform, poly);
    const recovered = transform.applyToPolygon(transform.inverse(xform), transformed);

    for (let i = 0; i < poly.vertices.length; i++) {
      expect(recovered.vertices[i].x).toBeCloseTo(poly.vertices[i].x, 8);
      expect(recovered.vertices[i].y).toBeCloseTo(poly.vertices[i].y, 8);
    }
  });
});

// ─── Cross-module: tiling → clipping → curved → piece ─────────────

describe('Cross-module pipeline: tiling → clipping → curved → piece', () => {
  it('hat tile: clip → curvy shape → straighten → createPiece', () => {
    const tiles = hat.generateHatTiling(100, 100, 0);
    const tile = tiles[0];
    const bb = polygon.boundingBox(tile.polygon);
    const rect: ClipRect = {
      minX: bb.min.x - 1, minY: bb.min.y - 1,
      maxX: bb.max.x + 1, maxY: bb.max.y + 1,
    };

    const clipped = clipPolygon(tile.polygon, rect);
    expect(clipped.vertices.length).toBeGreaterThanOrEqual(3);

    const curvy = createCurvyShape(clipped);
    expect(curvy.segments.length).toBe(clipped.vertices.length);

    const straightened = curvy.straighten();
    expect(straightened.vertices.length).toBe(clipped.vertices.length);

    const sideIds = Array.from({ length: clipped.vertices.length }, (_, i) => i + 1);
    const piece = createPiece(0, clipped, tile.transform, sideIds, false);
    expect(piece.sides.length).toBe(clipped.vertices.length);
    expect(piece.isFramePiece).toBe(false);
  });

  it('spectre tile: full pipeline with serialization roundtrip', () => {
    const tiles = spectre.generateSpectreTiling(100, 100, 0);
    const tile = tiles[0];

    const curvy = createCurvyShape(tile.polygon);
    expect(curvy.segments.length).toBe(14);

    const sideIds = Array.from({ length: 14 }, (_, i) => i + 1);
    const piece = createPiece(0, tile.polygon, tile.transform, sideIds, true);

    const framePoly = polygon.create([
      { x: -10, y: -10 }, { x: 10, y: -10 },
      { x: 10, y: 10 }, { x: -10, y: 10 },
    ]);
    const model = createPuzzleModel([piece], framePoly);
    const json = exportPuzzle(model, 'spectre', true);
    const restored = importPuzzle(json);

    expect(restored.pieces.length).toBe(1);
    expect(restored.pieces[0].isFramePiece).toBe(true);
    expect(restored.pieces[0].sides.length).toBe(14);
  });
});

// ─── Hat tiling depth growth ──────────────────────────────────────

describe('Hat tiling depth growth', () => {
  it('depth 0 produces exactly 4 hats from H metatile', () => {
    // With depth 0 and a large bounding box, H metatile gives 4 hats
    const tiles = hat.generateHatTiling(1000, 1000, 0);
    // H metatile has 4 children (hats)
    expect(tiles.length).toBe(4);
  });

  it('depth 1 produces more tiles than depth 0', () => {
    const tiles0 = hat.generateHatTiling(1000, 1000, 0);
    const tiles1 = hat.generateHatTiling(1000, 1000, 1);
    expect(tiles1.length).toBeGreaterThan(tiles0.length);
  });

  it('all hat tiles have 13 vertices regardless of depth', () => {
    const tiles = hat.generateHatTiling(500, 500, 1);
    for (const tile of tiles) {
      expect(polygon.numVertices(tile.polygon)).toBe(13);
    }
  });
});

// ─── Spectre tiling depth growth ──────────────────────────────────

describe('Spectre tiling depth growth', () => {
  it('depth 0 produces exactly 1 tile (Delta leaf)', () => {
    const tiles = spectre.generateSpectreTiling(100, 100, 0);
    expect(tiles.length).toBe(1);
  });

  it('depth 1 produces more tiles than depth 0', () => {
    const tiles0 = spectre.generateSpectreTiling(100, 100, 0);
    const tiles1 = spectre.generateSpectreTiling(100, 100, 1);
    expect(tiles1.length).toBeGreaterThan(tiles0.length);
  });

  it('all spectre tiles have 14 vertices regardless of depth', () => {
    const tiles = spectre.generateSpectreTiling(500, 500, 1);
    for (const tile of tiles) {
      expect(polygon.numVertices(tile.polygon)).toBe(14);
      expect(tile.type).toBe('spectre');
    }
  });
});

// ─── Geometry primitives used by puzzle modules ───────────────────

describe('Geometry primitives integrity', () => {
  it('polygon.area returns correct value for unit square', () => {
    const poly = unitSquare();
    expect(polygon.area(poly)).toBeCloseTo(1, 10);
  });

  it('polygon.area returns positive for CCW polygon', () => {
    const poly = unitTriangle();
    expect(polygon.area(poly)).toBeGreaterThan(0);
  });

  it('polygon.centroid is inside the polygon', () => {
    const poly = unitSquare();
    const c = polygon.centroid(poly);
    expect(polygon.containsPoint(poly, c)).toBe(true);
  });

  it('polygon.edges returns correct number', () => {
    expect(polygon.edges(unitSquare()).length).toBe(4);
    expect(polygon.edges(unitTriangle()).length).toBe(3);
  });

  it('polygon.perimeter is positive', () => {
    expect(polygon.perimeter(unitSquare())).toBeCloseTo(4, 10);
  });

  it('point.distance and magnitude are consistent', () => {
    const a = { x: 3, y: 4 };
    expect(point.magnitude(a)).toBeCloseTo(5, 10);
    expect(point.distance({ x: 0, y: 0 }, a)).toBeCloseTo(5, 10);
  });

  it('point.equals uses epsilon comparison', () => {
    expect(point.equals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(point.equals({ x: 1, y: 2 }, { x: 1.00000000001, y: 2 })).toBe(true);
    expect(point.equals({ x: 1, y: 2 }, { x: 1.001, y: 2 })).toBe(false);
  });
});
