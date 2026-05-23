import { describe, it, expect } from 'vitest';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';
import {
  type Piece,
  type Side,
  type SnapResult,
  createPiece,
  canSnapTo,
  mergePieces,
} from './piece';
import {
  type PuzzleModel,
  createPuzzleModel,
  checkWin,
  getPieceAt,
} from './puzzle-model';

// ── Helpers ───────────────────────────────────────────────────

function unitSquare() {
  return polygon.create([
    point.create(0, 0),
    point.create(1, 0),
    point.create(1, 1),
    point.create(0, 1),
  ]);
}

function unitTriangle() {
  return polygon.create([
    point.create(0, 0),
    point.create(1, 0),
    point.create(0.5, 1),
  ]);
}

// ── Tests ─────────────────────────────────────────────────────

describe('Piece', () => {
  // 1. Piece creation from a tile polygon
  it('creates a piece from a polygon with correct sides', () => {
    const sq = unitSquare();
    const t = transform.identity();
    const piece = createPiece(0, sq, t, [1, 2, 3, 4]);

    expect(piece.id).toBe(0);
    expect(piece.polygon).toBe(sq);
    expect(piece.transform).toEqual(t);
    expect(piece.sides).toHaveLength(4);
    expect(piece.isPlaced).toBe(false);
    expect(piece.isFramePiece).toBe(false);

    const edges = polygon.edges(sq);
    for (let i = 0; i < 4; i++) {
      expect(piece.sides[i].id).toBe(i + 1);
      expect(point.equals(piece.sides[i].ptA, edges[i].from)).toBe(true);
      expect(point.equals(piece.sides[i].ptB, edges[i].to)).toBe(true);
      expect(piece.sides[i].attachable).toBe(true);
    }
  });

  it('marks sides with id=0 as non-attachable', () => {
    const sq = unitSquare();
    const piece = createPiece(0, sq, transform.identity(), [0, 2, 3, 4]);
    expect(piece.sides[0].attachable).toBe(false);
    expect(piece.sides[1].attachable).toBe(true);
  });

  it('throws when sideIds length does not match vertex count', () => {
    const sq = unitSquare();
    expect(() => createPiece(0, sq, transform.identity(), [1, 2])).toThrow();
  });

  // 2. Side ID assignment
  it('assigns side IDs from the provided array', () => {
    const tri = unitTriangle();
    const piece = createPiece(1, tri, transform.identity(), [10, 20, 30]);
    expect(piece.sides.map(s => s.id)).toEqual([10, 20, 30]);
  });

  // 3. Complementary matching: side.id + otherSide.id === 0
  it('identifies complementary sides where id sum is zero', () => {
    const sq = unitSquare();
    const pieceA = createPiece(0, sq, transform.identity(), [1, 5, 3, 4]);
    const pieceB = createPiece(1, sq, transform.identity(), [6, 7, 8, -5]);

    const side5 = pieceA.sides[1]; // id = 5
    const sideNeg5 = pieceB.sides[3]; // id = -5

    expect(side5.id + sideNeg5.id).toBe(0);
  });

  // 4. canSnapTo returns SnapResult when pieces are within threshold and have matching sides
  it('returns SnapResult when pieces are within threshold with matching sides', () => {
    const sq = unitSquare();

    // Piece A at origin, side[1] (right edge) has id=+5
    const pieceA = createPiece(
      0, sq, transform.identity(),
      [1, 5, 3, 0],
    );

    // Piece B translated slightly right; side[3] (left edge) has id=-5
    const pieceB = createPiece(
      1, sq, transform.translation(1.02, 0.01),
      [6, 7, 8, -5],
    );

    const result = canSnapTo(pieceA, pieceB, 0.5);

    expect(result).not.toBeNull();
    expect(result!.sideA.id).toBe(5);
    expect(result!.sideB.id).toBe(-5);
    expect(result!.pieceA).toBe(pieceA);
    expect(result!.pieceB).toBe(pieceB);
    // Offset should approximately align B's side to A's side
    expect(Math.abs(result!.offset.x - (-0.02))).toBeLessThan(1e-10);
    expect(Math.abs(result!.offset.y - (-0.01))).toBeLessThan(1e-10);
  });

  // 5. canSnapTo returns null when pieces are too far apart
  it('returns null when pieces are too far apart', () => {
    const sq = unitSquare();

    const pieceA = createPiece(
      0, sq, transform.identity(),
      [1, 5, 3, 0],
    );

    // Piece B far away
    const pieceB = createPiece(
      1, sq, transform.translation(5, 5),
      [6, 7, 8, -5],
    );

    expect(canSnapTo(pieceA, pieceB, 0.5)).toBeNull();
  });

  // 6. canSnapTo returns null when no matching sides exist
  it('returns null when no matching sides exist', () => {
    const sq = unitSquare();

    const pieceA = createPiece(
      0, sq, transform.identity(),
      [1, 2, 3, 4],
    );

    // Adjacent but no complementary IDs
    const pieceB = createPiece(
      1, sq, transform.translation(1, 0),
      [5, 6, 7, 8],
    );

    expect(canSnapTo(pieceA, pieceB, 0.5)).toBeNull();
  });

  // 7 & 8. Piece merge: two adjacent pieces sharing one edge merge into composite
  it('merges two adjacent pieces sharing one edge', () => {
    const sq = unitSquare();

    const pieceA = createPiece(
      0, sq, transform.identity(),
      [1, 5, 3, 0],
    );

    const pieceB = createPiece(
      1, sq, transform.translation(1, 0),
      [6, 7, 8, -5],
    );

    const snap = canSnapTo(pieceA, pieceB, 0.5);
    expect(snap).not.toBeNull();

    const merged = mergePieces(pieceA, pieceB, snap!, 100);

    expect(merged.id).toBe(100);
    expect(merged.isPlaced).toBe(false);
    expect(merged.isFramePiece).toBe(false);
    // Transform is identity (polygon in world coords)
    expect(merged.transform).toEqual(transform.identity());

    // Test 8: Merged piece has N-2 fewer sides than sum
    // Original: 4 + 4 = 8 sides, remove 2 (shared edge) = 6
    expect(merged.sides).toHaveLength(6);
    expect(merged.polygon.vertices).toHaveLength(6);

    // Verify merged polygon is a 2×1 rectangle
    const verts = merged.polygon.vertices;
    const xs = verts.map(v => v.x);
    const ys = verts.map(v => v.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 10);
    expect(Math.max(...xs)).toBeCloseTo(2, 10);
    expect(Math.min(...ys)).toBeCloseTo(0, 10);
    expect(Math.max(...ys)).toBeCloseTo(1, 10);

    // Verify the complementary pair is gone
    const mergedIds = merged.sides.map(s => s.id);
    expect(mergedIds).not.toContain(5);
    expect(mergedIds).not.toContain(-5);

    // Verify remaining IDs are present
    expect(mergedIds).toContain(1);
    expect(mergedIds).toContain(3);
    expect(mergedIds).toContain(6);
    expect(mergedIds).toContain(7);
    expect(mergedIds).toContain(8);
    // id=0 was from piece A side[3] (boundary), still present
    expect(mergedIds).toContain(0);
  });

  it('merged polygon has positive (CCW) area', () => {
    const sq = unitSquare();

    const pieceA = createPiece(0, sq, transform.identity(), [1, 5, 3, 0]);
    const pieceB = createPiece(1, sq, transform.translation(1, 0), [6, 7, 8, -5]);

    const snap = canSnapTo(pieceA, pieceB, 0.5)!;
    const merged = mergePieces(pieceA, pieceB, snap, 100);

    expect(polygon.area(merged.polygon)).toBeGreaterThan(0);
  });
});

describe('PuzzleModel', () => {
  // 9. checkWin returns false when pieces not all placed
  it('checkWin() returns false when pieces not all placed', () => {
    const sq = unitSquare();
    const pieceA = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    const pieceB = createPiece(1, sq, transform.identity(), [5, 6, 7, 8]);

    const frame = polygon.create([
      point.create(-0.5, -0.5),
      point.create(2.5, -0.5),
      point.create(2.5, 1.5),
      point.create(-0.5, 1.5),
    ]);

    const model = createPuzzleModel([pieceA, pieceB], frame);

    expect(checkWin(model)).toBe(false);

    // Mark one as placed
    pieceA.isPlaced = true;
    expect(checkWin(model)).toBe(false);

    // Mark both as placed
    pieceB.isPlaced = true;
    expect(checkWin(model)).toBe(true);
  });

  // 10. getPieceAt finds correct piece under a point
  it('getPieceAt() finds correct piece under a point', () => {
    const sq = unitSquare();

    const pieceA = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    const pieceB = createPiece(1, sq, transform.translation(2, 0), [5, 6, 7, 8]);

    const frame = polygon.create([
      point.create(-1, -1),
      point.create(4, -1),
      point.create(4, 2),
      point.create(-1, 2),
    ]);

    const model = createPuzzleModel([pieceA, pieceB], frame);

    expect(getPieceAt(model, point.create(0.5, 0.5))).toBe(pieceA);
    expect(getPieceAt(model, point.create(2.5, 0.5))).toBe(pieceB);
    expect(getPieceAt(model, point.create(1.5, 0.5))).toBeNull();
    expect(getPieceAt(model, point.create(-1, -1))).toBeNull();
  });

  it('getPieceAt() returns last (top) piece when overlapping', () => {
    const sq = unitSquare();

    const pieceA = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    const pieceB = createPiece(1, sq, transform.translation(0.5, 0), [5, 6, 7, 8]);

    const frame = polygon.create([
      point.create(-1, -1),
      point.create(4, -1),
      point.create(4, 2),
      point.create(-1, 2),
    ]);

    const model = createPuzzleModel([pieceA, pieceB], frame);

    // Point at (0.75, 0.5) is inside both; should return pieceB (last/top)
    expect(getPieceAt(model, point.create(0.75, 0.5))).toBe(pieceB);
  });

  it('createPuzzleModel stores pieces and frame', () => {
    const sq = unitSquare();
    const piece = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    const frame = polygon.create([
      point.create(-1, -1),
      point.create(4, -1),
      point.create(4, 2),
      point.create(-1, 2),
    ]);
    const solMap = new Map([[0, transform.identity()]]);
    const model = createPuzzleModel([piece], frame, solMap);

    expect(model.pieces).toHaveLength(1);
    expect(model.framePolygon).toBe(frame);
    expect(model.solutionMap).toBe(solMap);
  });

  it('createPuzzleModel defaults solutionMap to empty Map', () => {
    const frame = polygon.create([
      point.create(0, 0),
      point.create(1, 0),
      point.create(1, 1),
      point.create(0, 1),
    ]);
    const model = createPuzzleModel([], frame);
    expect(model.solutionMap.size).toBe(0);
  });
});
