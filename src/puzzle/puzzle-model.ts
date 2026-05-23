import type { Point } from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import type { AffineTransform } from '../geometry/transform';
import type { EdgeCurveData } from '../tiling/curved';
import type { Piece } from './piece';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';

export interface PuzzleModel {
  pieces: Piece[];
  framePolygon: Polygon;
  frameTilePolygons: Polygon[];
  solutionMap: Map<number, AffineTransform>;
  curvedEdges: boolean;
  curveData: EdgeCurveData | null;
}

export function createPuzzleModel(
  pieces: Piece[],
  framePolygon: Polygon,
  solutionMap?: Map<number, AffineTransform>,
  frameTilePolygons?: Polygon[],
  curvedEdges?: boolean,
  curveData?: EdgeCurveData | null,
): PuzzleModel {
  return {
    pieces,
    framePolygon,
    frameTilePolygons: frameTilePolygons ?? [],
    solutionMap: solutionMap ?? new Map(),
    curvedEdges: curvedEdges ?? false,
    curveData: curveData ?? null,
  };
}

export function checkWin(model: PuzzleModel): boolean {
  return model.pieces.length > 0 && model.pieces.every(p => p.isPlaced);
}

export function getPieceAt(model: PuzzleModel, pt: Point): Piece | null {
  for (let i = model.pieces.length - 1; i >= 0; i--) {
    const piece = model.pieces[i];
    const localPt = transform.applyToPoint(transform.inverse(piece.transform), pt);
    if (polygon.containsPoint(piece.polygon, localPt)) {
      return piece;
    }
  }
  return null;
}
