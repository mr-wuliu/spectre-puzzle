import type { AffineTransform } from '../geometry/transform';
import type { Polygon } from '../geometry/polygon';
import type { PuzzleModel } from './puzzle-model';
import type { Piece } from './piece';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';

export interface WinResult {
  isComplete: boolean;
  allPlaced: boolean;
  areaMatch: boolean;
  noOverlaps: boolean;
  allInsideFrame: boolean;
  details: string;
}

const AREA_TOLERANCE = 0.01;

export function checkWinCondition(model: PuzzleModel): WinResult {
  const { pieces, framePolygon } = model;

  if (pieces.length === 0) {
    return {
      isComplete: true,
      allPlaced: true,
      areaMatch: true,
      noOverlaps: true,
      allInsideFrame: true,
      details: 'Puzzle is empty — trivially complete',
    };
  }

  const allPlaced = pieces.every(p => p.isPlaced);

  const totalPieceArea = pieces.reduce((sum, p) => {
    const worldPoly = transform.applyToPolygon(p.transform, p.polygon);
    return sum + Math.abs(polygon.area(worldPoly));
  }, 0);
  const frameArea = Math.abs(polygon.area(framePolygon));
  const areaRatio = frameArea === 0 ? 0 : Math.abs(totalPieceArea - frameArea) / frameArea;
  const areaMatch = areaRatio <= AREA_TOLERANCE;

  const noOverlaps = checkNoOverlaps(pieces);

  const allInsideFrame = checkAllInsideFrame(pieces, framePolygon);

  const isComplete = allPlaced && areaMatch && noOverlaps && allInsideFrame;

  const problems: string[] = [];
  if (!allPlaced) problems.push('not all pieces placed');
  if (!areaMatch) problems.push('area mismatch');
  if (!noOverlaps) problems.push('pieces overlap');
  if (!allInsideFrame) problems.push('pieces outside frame');

  return {
    isComplete,
    allPlaced,
    areaMatch,
    noOverlaps,
    allInsideFrame,
    details: isComplete
      ? 'Puzzle is complete!'
      : `Incomplete: ${problems.join(', ')}`,
  };
}

function checkNoOverlaps(pieces: Piece[]): boolean {
  for (let i = 0; i < pieces.length; i++) {
    const worldA = transform.applyToPolygon(pieces[i].transform, pieces[i].polygon);
    const centroidA = polygon.centroid(worldA);
    for (let j = i + 1; j < pieces.length; j++) {
      const worldB = transform.applyToPolygon(pieces[j].transform, pieces[j].polygon);
      const centroidB = polygon.centroid(worldB);
      if (polygon.containsPoint(worldA, centroidB) || polygon.containsPoint(worldB, centroidA)) {
        return false;
      }
    }
  }
  return true;
}

function checkAllInsideFrame(pieces: Piece[], framePolygon: Polygon): boolean {
  for (const piece of pieces) {
    const worldPoly = transform.applyToPolygon(piece.transform, piece.polygon);
    for (const vertex of worldPoly.vertices) {
      if (!polygon.containsPoint(framePolygon, vertex)) {
        return false;
      }
    }
  }
  return true;
}

export interface RevealStep {
  done: boolean;
  pieceId: number;
  transform: AffineTransform;
}

export class SolutionRevealer {
  private readonly pieces: Piece[];
  private readonly solutionMap: Map<number, AffineTransform>;
  private readonly solvablePieceIds: number[];
  private currentIndex = 0;

  constructor(pieces: Piece[], solutionMap: Map<number, AffineTransform>) {
    this.pieces = pieces;
    this.solutionMap = solutionMap;
    this.solvablePieceIds = pieces
      .map(p => p.id)
      .filter(id => solutionMap.has(id));
  }

  step(): RevealStep {
    if (this.currentIndex >= this.solvablePieceIds.length) {
      return { done: true, pieceId: -1, transform: transform.identity() };
    }

    const pieceId = this.solvablePieceIds[this.currentIndex];
    const xform = this.solutionMap.get(pieceId)!;
    this.currentIndex++;

    return { done: false, pieceId, transform: xform };
  }

  reveal(
    onPiecePlaced: (pieceId: number, xform: AffineTransform) => void,
    onComplete: () => void,
  ): void {
    for (;;) {
      const s = this.step();
      if (s.done) {
        onComplete();
        return;
      }
      onPiecePlaced(s.pieceId, s.transform);
    }
  }
}
