import type { AffineTransform } from '../geometry/transform';
import type { BezierSegment } from '../tiling/curved';
import type { Piece, SnapResult } from './piece';
import type { PuzzleModel } from './puzzle-model';
import * as point from '../geometry/point';
import * as transform from '../geometry/transform';
import { canSnapTo, mergePieces } from './piece';

export const DEFAULT_SNAP_THRESHOLD = 8;

export function findSnapTarget(
  piece: Piece,
  puzzle: PuzzleModel,
  threshold: number = DEFAULT_SNAP_THRESHOLD,
  angleThreshold?: number,
  allowGeometricMatch = false,
  includeNonAttachableGeometricMatch = false,
): SnapResult | null {
  let bestSnap: SnapResult | null = null;
  let bestDist = Infinity;

  for (const other of puzzle.pieces) {
    if (other.id === piece.id) continue;

    const snap = canSnapTo(
      piece,
      other,
      threshold,
      angleThreshold,
      allowGeometricMatch,
      includeNonAttachableGeometricMatch,
    );
    if (snap === null) continue;

    const dist = snap.distance ?? point.magnitude(snap.offset);
    if (dist < bestDist) {
      bestDist = dist;
      bestSnap = snap;
    }
  }

  return bestSnap;
}

export function applySnap(
  snap: SnapResult,
  puzzle: PuzzleModel,
  newId: number,
): PuzzleModel {
  const adjustedTransform = snap.adjustedTransform ?? transform.compose(
    transform.translation(-snap.offset.x, -snap.offset.y),
    snap.pieceA.transform,
  );

  const adjustedPieceA: Piece = {
    ...snap.pieceA,
    transform: adjustedTransform,
  };

  const adjustedSnap: SnapResult = {
    ...snap,
    pieceA: adjustedPieceA,
  };

  const composite = mergePieces(adjustedPieceA, snap.pieceB, adjustedSnap, newId);

  const removedIds = new Set([snap.pieceA.id, snap.pieceB.id]);
  const remainingPieces = puzzle.pieces.filter(p => !removedIds.has(p.id));

  return {
    pieces: [...remainingPieces, composite],
    framePolygon: puzzle.framePolygon,
    frameTilePolygons: puzzle.frameTilePolygons,
    solutionMap: puzzle.solutionMap,
    curvedEdges: puzzle.curvedEdges,
    curveData: puzzle.curveData,
  };
}

export function matchCurvedEdges(
  segA: BezierSegment,
  segB: BezierSegment,
  xformA: AffineTransform,
  xformB: AffineTransform,
  tolerance: number,
): number {
  const wA = [
    transform.applyToPoint(xformA, segA.from),
    transform.applyToPoint(xformA, segA.cp1),
    transform.applyToPoint(xformA, segA.cp2),
    transform.applyToPoint(xformA, segA.to),
  ];
  const wB = [
    transform.applyToPoint(xformB, segB.from),
    transform.applyToPoint(xformB, segB.cp1),
    transform.applyToPoint(xformB, segB.cp2),
    transform.applyToPoint(xformB, segB.to),
  ];

  let maxDist = 0;
  for (let i = 0; i < 4; i++) {
    const d = point.distance(wA[i], wB[3 - i]);
    if (d > tolerance) return Infinity;
    maxDist = Math.max(maxDist, d);
  }
  return maxDist;
}
