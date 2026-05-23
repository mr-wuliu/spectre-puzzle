import { describe, it, expect } from 'vitest';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';
import { createPiece, type Piece } from './piece';
import { createPuzzleModel, type PuzzleModel } from './puzzle-model';
import { checkWinCondition, SolutionRevealer, type WinResult } from './win';

// ── Helpers ───────────────────────────────────────────────────

function unitSquare() {
  return polygon.create([
    point.create(0, 0),
    point.create(1, 0),
    point.create(1, 1),
    point.create(0, 1),
  ]);
}

/** Two unit squares that tile a 2×1 rectangle side-by-side, both placed. */
function solvedTwoPieceModel(): PuzzleModel {
  const sq = unitSquare();
  const pieceA = createPiece(0, sq, transform.identity(), [1, 5, 3, 0]);
  const pieceB = createPiece(1, sq, transform.translation(1, 0), [6, 7, 8, -5]);
  pieceA.isPlaced = true;
  pieceB.isPlaced = true;

  // Frame slightly larger than the union to avoid boundary-point issues
  const frame = polygon.create([
    point.create(-0.001, -0.001),
    point.create(2.001, -0.001),
    point.create(2.001, 1.001),
    point.create(-0.001, 1.001),
  ]);

  const solutionMap = new Map([
    [0, transform.identity()],
    [1, transform.translation(1, 0)],
  ]);

  return createPuzzleModel([pieceA, pieceB], frame, solutionMap);
}

// ── checkWinCondition ─────────────────────────────────────────

describe('checkWinCondition', () => {
  it('detects a complete win when all pieces placed, area matches, no overlaps, all inside frame', () => {
    const model = solvedTwoPieceModel();
    const result = checkWinCondition(model);

    expect(result.isComplete).toBe(true);
    expect(result.allPlaced).toBe(true);
    expect(result.areaMatch).toBe(true);
    expect(result.noOverlaps).toBe(true);
    expect(result.allInsideFrame).toBe(true);
  });

  it('returns allPlaced=false when one piece is unplaced', () => {
    const model = solvedTwoPieceModel();
    model.pieces[0].isPlaced = false;

    const result = checkWinCondition(model);
    expect(result.allPlaced).toBe(false);
    expect(result.isComplete).toBe(false);
    expect(result.details).toContain('not all pieces placed');
  });

  it('returns noOverlaps=false when piece centroids overlap', () => {
    // Two unit squares both at origin — clearly overlapping
    const sq = unitSquare();
    const pieceA = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    const pieceB = createPiece(1, sq, transform.identity(), [5, 6, 7, 8]);
    pieceA.isPlaced = true;
    pieceB.isPlaced = true;

    const frame = polygon.create([
      point.create(-1, -1),
      point.create(2, -1),
      point.create(2, 2),
      point.create(-1, 2),
    ]);

    const model = createPuzzleModel([pieceA, pieceB], frame);
    const result = checkWinCondition(model);

    expect(result.noOverlaps).toBe(false);
    expect(result.isComplete).toBe(false);
    expect(result.details).toContain('overlap');
  });

  it('returns allInsideFrame=false when a piece vertex is outside the frame', () => {
    const sq = unitSquare();
    // Place a piece so it extends beyond the frame
    const piece = createPiece(0, sq, transform.translation(1.5, 0), [1, 2, 3, 4]);
    piece.isPlaced = true;

    // Frame only covers [0,0]→[2,0]→[2,1]→[0,1]
    const frame = polygon.create([
      point.create(0, 0),
      point.create(2, 0),
      point.create(2, 1),
      point.create(0, 1),
    ]);

    const model = createPuzzleModel([piece], frame);
    const result = checkWinCondition(model);

    expect(result.allInsideFrame).toBe(false);
    expect(result.isComplete).toBe(false);
    expect(result.details).toContain('outside');
  });

  it('returns areaMatch=false when total piece area does not match frame area', () => {
    const sq = unitSquare();
    // Only one unit-square piece, but frame covers 2×1 rectangle (area=2)
    const piece = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    piece.isPlaced = true;

    const frame = polygon.create([
      point.create(0, 0),
      point.create(2, 0),
      point.create(2, 1),
      point.create(0, 1),
    ]);

    const model = createPuzzleModel([piece], frame);
    const result = checkWinCondition(model);

    expect(result.areaMatch).toBe(false);
    expect(result.isComplete).toBe(false);
    expect(result.details).toContain('area');
  });

  it('returns isComplete=true for empty puzzle (trivially solved)', () => {
    const frame = polygon.create([
      point.create(0, 0),
      point.create(1, 0),
      point.create(1, 1),
      point.create(0, 1),
    ]);
    const model = createPuzzleModel([], frame);
    const result = checkWinCondition(model);

    expect(result.isComplete).toBe(true);
    expect(result.allPlaced).toBe(true);
    expect(result.areaMatch).toBe(true);
    expect(result.noOverlaps).toBe(true);
    expect(result.allInsideFrame).toBe(true);
  });

  it('uses 1% tolerance for area comparison', () => {
    const sq = unitSquare();
    const pieceA = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    pieceA.isPlaced = true;

    // Frame area = 1.005 — within 1% of piece area (1.0)
    const frame = polygon.create([
      point.create(0, 0),
      point.create(1.005, 0),
      point.create(1.005, 1),
      point.create(0, 1),
    ]);

    const model = createPuzzleModel([pieceA], frame);
    const result = checkWinCondition(model);
    expect(result.areaMatch).toBe(true);
  });
});

// ── SolutionRevealer ──────────────────────────────────────────

describe('SolutionRevealer', () => {
  it('produces correct sequence of piece placements', () => {
    const sq = unitSquare();
    const pieceA = createPiece(0, sq, transform.identity(), [1, 2, 3, 4]);
    const pieceB = createPiece(1, sq, transform.identity(), [5, 6, 7, 8]);

    const solutionMap = new Map([
      [0, transform.translation(10, 20)],
      [1, transform.translation(30, 40)],
    ]);

    const revealer = new SolutionRevealer([pieceA, pieceB], solutionMap);

    // Step 1: reveal piece 0
    const step1 = revealer.step();
    expect(step1).not.toBeNull();
    expect(step1!.done).toBe(false);
    expect(step1!.pieceId).toBe(0);
    expect(step1!.transform).toEqual(transform.translation(10, 20));

    // Step 2: reveal piece 1
    const step2 = revealer.step();
    expect(step2).not.toBeNull();
    expect(step2!.done).toBe(false);
    expect(step2!.pieceId).toBe(1);
    expect(step2!.transform).toEqual(transform.translation(30, 40));

    // Step 3: done
    const step3 = revealer.step();
    expect(step3!.done).toBe(true);
  });

  it('fires onComplete after all pieces processed', () => {
    const sq = unitSquare();
    const pieces = [
      createPiece(0, sq, transform.identity(), [1, 2, 3, 4]),
      createPiece(1, sq, transform.identity(), [5, 6, 7, 8]),
      createPiece(2, sq, transform.identity(), [9, 10, 11, 12]),
    ];

    const solutionMap = new Map([
      [0, transform.translation(1, 0)],
      [1, transform.translation(2, 0)],
      [2, transform.translation(3, 0)],
    ]);

    const revealer = new SolutionRevealer(pieces, solutionMap);

    const results: number[] = [];
    let doneCount = 0;

    // Step through all pieces
    for (;;) {
      const s = revealer.step();
      if (s!.done) {
        doneCount++;
        break;
      }
      results.push(s!.pieceId);
    }

    expect(doneCount).toBe(1);
    expect(results).toEqual([0, 1, 2]);
  });

  it('handles empty pieces list (immediately done)', () => {
    const solutionMap = new Map<number, ReturnType<typeof transform.identity>>();
    const revealer = new SolutionRevealer([], solutionMap);

    const s = revealer.step();
    expect(s!.done).toBe(true);
  });

  it('skips pieces not in solutionMap', () => {
    const sq = unitSquare();
    const pieces = [
      createPiece(0, sq, transform.identity(), [1, 2, 3, 4]),
      createPiece(1, sq, transform.identity(), [5, 6, 7, 8]),
    ];

    // Only piece 1 has a solution
    const solutionMap = new Map([
      [1, transform.translation(5, 5)],
    ]);

    const revealer = new SolutionRevealer(pieces, solutionMap);

    const step1 = revealer.step();
    expect(step1!.done).toBe(false);
    expect(step1!.pieceId).toBe(1);
    expect(step1!.transform).toEqual(transform.translation(5, 5));

    const step2 = revealer.step();
    expect(step2!.done).toBe(true);
  });

  it('reveal() callback pattern produces staggered events', () => {
    const sq = unitSquare();
    const pieces = [
      createPiece(0, sq, transform.identity(), [1, 2, 3, 4]),
      createPiece(1, sq, transform.identity(), [5, 6, 7, 8]),
    ];

    const solutionMap = new Map([
      [0, transform.translation(10, 0)],
      [1, transform.translation(20, 0)],
    ]);

    const revealer = new SolutionRevealer(pieces, solutionMap);

    const placed: Array<{ pieceId: number; transform: ReturnType<typeof transform.identity> }> = [];
    let completed = false;

    revealer.reveal(
      (pieceId, xform) => { placed.push({ pieceId, transform: xform }); },
      () => { completed = true; },
    );

    expect(placed).toHaveLength(2);
    expect(placed[0].pieceId).toBe(0);
    expect(placed[0].transform).toEqual(transform.translation(10, 0));
    expect(placed[1].pieceId).toBe(1);
    expect(placed[1].transform).toEqual(transform.translation(20, 0));
    expect(completed).toBe(true);
  });
});
