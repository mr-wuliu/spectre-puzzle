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
  solutionMatch: boolean;
  noOverlaps: boolean;
  allInsideFrame: boolean;
  details: string;
}

const AREA_TOLERANCE = 0.01;
const SOLUTION_TOLERANCE = 0.1;

export function checkWinCondition(model: PuzzleModel): WinResult {
  const { pieces, framePolygon, frameTilePolygons } = model;

  if (pieces.length === 0) {
    return {
      isComplete: true,
      allPlaced: true,
      areaMatch: true,
      solutionMatch: true,
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
  const targetArea = frameTilePolygons.length > 0
    ? frameTilePolygons.reduce((sum, p) => sum + Math.abs(polygon.area(p)), 0)
    : Math.abs(polygon.area(framePolygon));
  const areaRatio = targetArea === 0 ? 0 : Math.abs(totalPieceArea - targetArea) / targetArea;
  const areaMatch = areaRatio <= AREA_TOLERANCE;

  const noOverlaps = checkNoOverlaps(pieces);

  const allInsideFrame = checkAllInsideFrame(pieces, framePolygon);
  const solutionMatch = frameTilePolygons.length > 0
    ? checkTargetTileMatch(pieces, frameTilePolygons)
    : checkSolutionMatch(pieces, model.solutionMap);

  const isComplete = allPlaced
    && areaMatch
    && solutionMatch
    && noOverlaps
    && allInsideFrame;

  const problems: string[] = [];
  if (!allPlaced) problems.push('not all pieces placed');
  if (!areaMatch) problems.push('area mismatch');
  if (!solutionMatch) problems.push('pieces not in solution positions');
  if (!noOverlaps) problems.push('pieces overlap');
  if (!allInsideFrame) problems.push('pieces outside frame');

  return {
    isComplete,
    allPlaced,
    areaMatch,
    solutionMatch,
    noOverlaps,
    allInsideFrame,
    details: isComplete
      ? 'Puzzle is complete!'
      : `Incomplete: ${problems.join(', ')}`,
  };
}

function checkSolutionMatch(
  pieces: Piece[],
  solutionMap: Map<number, AffineTransform>,
): boolean {
  if (!pieces.every((p) => solutionMap.has(p.id))) return true;
  for (const piece of pieces) {
    const solution = solutionMap.get(piece.id);
    if (!solution) return false;

    const current = transform.applyToPolygon(piece.transform, piece.polygon);
    const target = transform.applyToPolygon(solution, piece.polygon);
    if (current.vertices.length !== target.vertices.length) return false;

    for (let i = 0; i < current.vertices.length; i++) {
      const dx = current.vertices[i].x - target.vertices[i].x;
      const dy = current.vertices[i].y - target.vertices[i].y;
      if (Math.hypot(dx, dy) > SOLUTION_TOLERANCE) return false;
    }
  }
  return true;
}

function checkTargetTileMatch(
  pieces: Piece[],
  targetPolys: Polygon[],
): boolean {
  if (pieces.length !== targetPolys.length) return false;
  const usedTargets = new Set<number>();

  const currentPolys = pieces.map((piece) => transform.applyToPolygon(piece.transform, piece.polygon));
  const order = currentPolys
    .map((poly, index) => ({ index, area: Math.abs(polygon.area(poly)) }))
    .sort((a, b) => b.area - a.area);

  for (const item of order) {
    let matched = -1;
    for (let targetIndex = 0; targetIndex < targetPolys.length; targetIndex++) {
      if (usedTargets.has(targetIndex)) continue;
      if (polygonsMatch(currentPolys[item.index], targetPolys[targetIndex])) {
        matched = targetIndex;
        break;
      }
    }
    if (matched === -1) return false;
    usedTargets.add(matched);
  }

  return true;
}

function polygonsMatch(a: Polygon, b: Polygon): boolean {
  const av = a.vertices;
  const bv = b.vertices;
  if (av.length !== bv.length) return false;

  const n = av.length;
  for (let offset = 0; offset < n; offset++) {
    let forward = true;
    let reverse = true;
    for (let i = 0; i < n; i++) {
      if (pointDistance(av[i], bv[(offset + i) % n]) > SOLUTION_TOLERANCE) {
        forward = false;
      }
      if (pointDistance(av[i], bv[(offset - i + n) % n]) > SOLUTION_TOLERANCE) {
        reverse = false;
      }
      if (!forward && !reverse) break;
    }
    if (forward || reverse) return true;
  }

  return false;
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
      if (!polygon.containsPoint(framePolygon, vertex) && !pointOnPolygonBoundary(vertex, framePolygon)) {
        return false;
      }
    }
  }
  return true;
}

function pointOnPolygonBoundary(pt: { x: number; y: number }, poly: Polygon): boolean {
  const eps = 1e-6;
  const verts = poly.vertices;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < eps) continue;
    const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
    if (t < -eps || t > 1 + eps) continue;
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const distSq = (pt.x - projX) ** 2 + (pt.y - projY) ** 2;
    if (distSq <= eps * eps) return true;
  }
  return false;
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
