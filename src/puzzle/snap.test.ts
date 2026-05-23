import { describe, it, expect } from 'vitest';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';
import { createPiece } from './piece';
import { createPuzzleModel } from './puzzle-model';
import {
  findSnapTarget,
  applySnap,
  matchCurvedEdges,
  DEFAULT_SNAP_THRESHOLD,
} from './snap';
import type { BezierSegment } from '../tiling/curved';

function unitSquare() {
  return polygon.create([
    point.create(0, 0),
    point.create(1, 0),
    point.create(1, 1),
    point.create(0, 1),
  ]);
}

function makePiece(
  id: number,
  xform: ReturnType<typeof transform.identity>,
  sideIds: number[],
) {
  return createPiece(id, unitSquare(), xform, sideIds);
}

function bigFrame() {
  return polygon.create([
    point.create(-10, -10),
    point.create(20, -10),
    point.create(20, 20),
    point.create(-10, 20),
  ]);
}

describe('findSnapTarget', () => {
  it('finds correct match with pieces within threshold', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.02, 0.01), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const result = findSnapTarget(pieceA, puzzle, 0.5);

    expect(result).not.toBeNull();
    expect(result!.sideA.id).toBe(5);
    expect(result!.sideB.id).toBe(-5);
    expect(result!.pieceA).toBe(pieceA);
    expect(result!.pieceB).toBe(pieceB);
  });

  it('finds a match when complementary edges need a small rotation correction', () => {
    const pieceA = makePiece(0, transform.rotation(Math.PI / 36), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.02, 0.01), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const result = findSnapTarget(pieceA, puzzle, 0.5);

    expect(result).not.toBeNull();
    expect(result!.adjustedTransform).toBeDefined();
  });

  it('returns null when pieces are beyond threshold', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(5, 5), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    expect(findSnapTarget(pieceA, puzzle, 0.5)).toBeNull();
  });

  it('returns null when no matching sides exist', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 2, 3, 4]);
    const pieceB = makePiece(1, transform.translation(1.01, 0), [5, 6, 7, 8]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    expect(findSnapTarget(pieceA, puzzle, 0.5)).toBeNull();
  });

  it('can use geometric edge matching when side ids are not complementary', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 2, 3, 4]);
    const pieceB = makePiece(1, transform.translation(1.01, 0), [5, 6, 7, 8]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const result = findSnapTarget(pieceA, puzzle, 0.5, Math.PI / 36, true);

    expect(result).not.toBeNull();
    expect(result!.sideA.id + result!.sideB.id).not.toBe(0);
  });

  it('can include non-attachable boundary edges in geometric matching', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 0, 3, 4]);
    const pieceB = makePiece(1, transform.translation(1.01, 0), [5, 6, 7, 0]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const withoutBoundary = findSnapTarget(pieceA, puzzle, 0.5, Math.PI / 36, true);
    const withBoundary = findSnapTarget(pieceA, puzzle, 0.5, Math.PI / 36, true, true);

    expect(withoutBoundary).toBeNull();
    expect(withBoundary).not.toBeNull();
    expect(withBoundary!.sideA.id).toBe(0);
    expect(withBoundary!.sideB.id).toBe(0);
  });

  it('returns null when puzzle has no other pieces', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const puzzle = createPuzzleModel([pieceA], bigFrame());
    expect(findSnapTarget(pieceA, puzzle, 0.5)).toBeNull();
  });

  it('picks the closest snap candidate when multiple matches exist', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.01, 0.01), [6, 7, 8, -5]);
    const pieceC = makePiece(2, transform.translation(1.04, 0.02), [9, 10, 11, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB, pieceC], bigFrame());
    const result = findSnapTarget(pieceA, puzzle, 0.5);

    expect(result).not.toBeNull();
    expect(result!.pieceB.id).toBe(1);
  });

  it('uses default threshold of 8 when not specified', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.5, 2), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const result = findSnapTarget(pieceA, puzzle);

    expect(result).not.toBeNull();
    expect(DEFAULT_SNAP_THRESHOLD).toBe(8);
  });
});

describe('applySnap', () => {
  it('moves piece to snap position and merges into composite', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.02, 0.01), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const snap = findSnapTarget(pieceA, puzzle, 0.5)!;
    const updated = applySnap(snap, puzzle, 100);

    expect(updated.pieces).toHaveLength(1);
    const composite = updated.pieces[0];
    expect(composite.id).toBe(100);
    expect(composite.sides).toHaveLength(6);

    const xs = composite.polygon.vertices.map(v => v.x);
    const ys = composite.polygon.vertices.map(v => v.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(2, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(1, 1);
  });

  it('produces composite with N-2 fewer sides than the sum', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1, 0), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const snap = findSnapTarget(pieceA, puzzle, 0.5)!;
    const updated = applySnap(snap, puzzle, 200);

    const composite = updated.pieces[0];
    expect(composite.sides).toHaveLength(6);
    expect(composite.polygon.vertices).toHaveLength(6);

    const xs = composite.polygon.vertices.map(v => v.x);
    const ys = composite.polygon.vertices.map(v => v.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 10);
    expect(Math.max(...xs)).toBeCloseTo(2, 10);
    expect(Math.min(...ys)).toBeCloseTo(0, 10);
    expect(Math.max(...ys)).toBeCloseTo(1, 10);
  });

  it('removes both original pieces and adds composite', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.02, 0.01), [6, 7, 8, -5]);
    const pieceC = makePiece(2, transform.translation(3, 0), [9, 10, 11, 12]);

    const puzzle = createPuzzleModel([pieceA, pieceB, pieceC], bigFrame());
    const snap = findSnapTarget(pieceA, puzzle, 0.5)!;
    const updated = applySnap(snap, puzzle, 200);

    expect(updated.pieces).toHaveLength(2);
    const ids = updated.pieces.map(p => p.id);
    expect(ids).toContain(200);
    expect(ids).toContain(2);
    expect(ids).not.toContain(0);
    expect(ids).not.toContain(1);
  });

  it('composite side IDs exclude the merged pair', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.02, 0.01), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const snap = findSnapTarget(pieceA, puzzle, 0.5)!;
    const updated = applySnap(snap, puzzle, 100);

    const sideIds = updated.pieces[0].sides.map(s => s.id);
    expect(sideIds).not.toContain(5);
    expect(sideIds).not.toContain(-5);
    expect(sideIds).toContain(1);
    expect(sideIds).toContain(3);
    expect(sideIds).toContain(0);
    expect(sideIds).toContain(6);
    expect(sideIds).toContain(7);
    expect(sideIds).toContain(8);
  });

  it('preserves frame polygon and solution map', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.02, 0.01), [6, 7, 8, -5]);

    const solMap = new Map([[0, transform.identity()]]);
    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame(), solMap);

    const snap = findSnapTarget(pieceA, puzzle, 0.5)!;
    const updated = applySnap(snap, puzzle, 100);

    expect(updated.framePolygon).toBe(puzzle.framePolygon);
    expect(updated.solutionMap).toBe(puzzle.solutionMap);
  });

  it('assigns the given newId to the composite', () => {
    const pieceA = makePiece(0, transform.identity(), [1, 5, 3, 0]);
    const pieceB = makePiece(1, transform.translation(1.02, 0.01), [6, 7, 8, -5]);

    const puzzle = createPuzzleModel([pieceA, pieceB], bigFrame());
    const snap = findSnapTarget(pieceA, puzzle, 0.5)!;
    const updated = applySnap(snap, puzzle, 42);

    expect(updated.pieces[0].id).toBe(42);
  });
});

describe('matchCurvedEdges', () => {
  it('returns near-zero for perfectly complementary Bézier segments', () => {
    const segA: BezierSegment = {
      from: { x: 0, y: 0 },
      cp1: { x: 0.33, y: 0.2 },
      cp2: { x: 0.67, y: 0.2 },
      to: { x: 1, y: 0 },
    };

    const segB: BezierSegment = {
      from: { x: 1, y: 0 },
      cp1: { x: 0.67, y: 0.2 },
      cp2: { x: 0.33, y: 0.2 },
      to: { x: 0, y: 0 },
    };

    const dist = matchCurvedEdges(
      segA, segB,
      transform.identity(), transform.identity(),
      0.5,
    );

    expect(dist).toBeCloseTo(0, 10);
    expect(dist).toBeLessThan(0.5);
  });

  it('returns Infinity when any control point pair exceeds tolerance', () => {
    const segA: BezierSegment = {
      from: { x: 0, y: 0 },
      cp1: { x: 0.3, y: 0 },
      cp2: { x: 0.7, y: 0 },
      to: { x: 1, y: 0 },
    };

    const segB: BezierSegment = {
      from: { x: 10, y: 10 },
      cp1: { x: 10, y: 10 },
      cp2: { x: 10, y: 10 },
      to: { x: 10, y: 10 },
    };

    const dist = matchCurvedEdges(
      segA, segB,
      transform.identity(), transform.identity(),
      0.5,
    );

    expect(dist).toBe(Infinity);
  });

  it('returns Infinity for curves with one control point offset beyond tolerance', () => {
    const segA: BezierSegment = {
      from: { x: 0, y: 0 },
      cp1: { x: 0.33, y: 0.2 },
      cp2: { x: 0.67, y: 0.2 },
      to: { x: 1, y: 0 },
    };

    const segB: BezierSegment = {
      from: { x: 1, y: 0 },
      cp1: { x: 0.67, y: 1.2 },
      cp2: { x: 0.33, y: 0.2 },
      to: { x: 0, y: 0 },
    };

    const dist = matchCurvedEdges(
      segA, segB,
      transform.identity(), transform.identity(),
      0.5,
    );

    expect(dist).toBe(Infinity);
  });

  it('accounts for transforms when comparing control points', () => {
    const segA: BezierSegment = {
      from: { x: 0, y: 0 },
      cp1: { x: 0.33, y: 0.2 },
      cp2: { x: 0.67, y: 0.2 },
      to: { x: 1, y: 0 },
    };

    const segB: BezierSegment = {
      from: { x: 1, y: 0 },
      cp1: { x: 0.67, y: 0.2 },
      cp2: { x: 0.33, y: 0.2 },
      to: { x: 0, y: 0 },
    };

    const distMatch = matchCurvedEdges(
      segA, segB,
      transform.identity(), transform.identity(),
      0.1,
    );
    expect(distMatch).toBeLessThan(0.1);

    const distNoMatch = matchCurvedEdges(
      segA, segB,
      transform.identity(), transform.translation(5, 5),
      0.1,
    );
    expect(distNoMatch).toBe(Infinity);
  });
});
