import type { Point } from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import type { AffineTransform } from '../geometry/transform';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';

export interface Side {
  id: number;
  ptA: Point;
  ptB: Point;
  attachable: boolean;
}

export interface Piece {
  id: number;
  polygon: Polygon;
  transform: AffineTransform;
  sides: Side[];
  isPlaced: boolean;
  isFramePiece: boolean;
}

export interface SnapResult {
  pieceA: Piece;
  pieceB: Piece;
  sideA: Side;
  sideB: Side;
  offset: Point;
  adjustedTransform?: AffineTransform;
  distance?: number;
}

export function createPiece(
  id: number,
  poly: Polygon,
  xform: AffineTransform,
  sideIds: number[],
  isFramePiece = false,
): Piece {
  const n = polygon.numVertices(poly);
  if (sideIds.length !== n) {
    throw new Error(
      `sideIds length (${sideIds.length}) must match vertex count (${n})`,
    );
  }

  const edges = polygon.edges(poly);
  const sides: Side[] = edges.map((edge, i) => ({
    id: sideIds[i],
    ptA: { x: edge.from.x, y: edge.from.y },
    ptB: { x: edge.to.x, y: edge.to.y },
    attachable: sideIds[i] !== 0,
  }));

  return {
    id,
    polygon: poly,
    transform: xform,
    sides,
    isPlaced: false,
    isFramePiece,
  };
}

export function canSnapTo(
  pieceA: Piece,
  pieceB: Piece,
  threshold: number,
  angleThreshold: number = Math.PI / 12,
  allowGeometricMatch = false,
  includeNonAttachableGeometricMatch = false,
): SnapResult | null {
  const lengthTolerance = threshold;
  let bestSnap: SnapResult | null = null;
  let bestDistance = Infinity;

  for (const sideA of pieceA.sides) {
    if (!sideA.attachable && !(allowGeometricMatch && includeNonAttachableGeometricMatch)) continue;

    for (const sideB of pieceB.sides) {
      if (!sideB.attachable && !(allowGeometricMatch && includeNonAttachableGeometricMatch)) continue;
      const idsMatch = sideA.id + sideB.id === 0;
      const canUseIdMatch = idsMatch && sideA.attachable && sideB.attachable;
      if (!canUseIdMatch && !allowGeometricMatch) continue;

      const wAs = transform.applyToPoint(pieceA.transform, sideA.ptA);
      const wAe = transform.applyToPoint(pieceA.transform, sideA.ptB);
      const wBs = transform.applyToPoint(pieceB.transform, sideB.ptA);
      const wBe = transform.applyToPoint(pieceB.transform, sideB.ptB);

      const vecA = point.subtract(wAe, wAs);
      const targetVec = point.subtract(wBs, wBe);
      const lenA = point.magnitude(vecA);
      const lenB = point.magnitude(targetVec);
      if (!canUseIdMatch) {
        if (Math.abs(lenA - lenB) > lengthTolerance) continue;
      }

      const angleA = Math.atan2(vecA.y, vecA.x);
      const targetAngle = Math.atan2(targetVec.y, targetVec.x);
      const rotationDelta = normalizeAngle(targetAngle - angleA);
      if (Math.abs(rotationDelta) > angleThreshold) continue;

      const midA = point.scale(point.add(wAs, wAe), 0.5);
      const midB = point.scale(point.add(wBe, wBs), 0.5);
      if (point.distance(midA, midB) > threshold) continue;

      const adjustedTransform = transform.compose(
        transform.translation(wBe.x, wBe.y),
        transform.compose(
          transform.rotation(rotationDelta),
          transform.compose(
            transform.translation(-wAs.x, -wAs.y),
            pieceA.transform,
          ),
        ),
      );

      const adjustedAs = transform.applyToPoint(adjustedTransform, sideA.ptA);
      const adjustedAe = transform.applyToPoint(adjustedTransform, sideA.ptB);

      const d1 = point.distance(adjustedAs, wBe);
      const d2 = point.distance(adjustedAe, wBs);
      const distance = Math.max(
        d1,
        d2,
        Math.abs(lenA - lenB),
        point.distance(midA, midB),
      );

      if (d1 < threshold && d2 < threshold) {
        const offset: Point = {
          x: ((wAs.x - wBe.x) + (wAe.x - wBs.x)) / 2,
          y: ((wAs.y - wBe.y) + (wAe.y - wBs.y)) / 2,
        };
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSnap = {
            pieceA,
            pieceB,
            sideA,
            sideB,
            offset,
            adjustedTransform,
            distance,
          };
        }
      }
    }
  }

  return bestSnap;
}

function normalizeAngle(angle: number): number {
  let a = angle;
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

export function mergePieces(
  pieceA: Piece,
  pieceB: Piece,
  snap: SnapResult,
  newId: number,
): Piece {
  const remaining: Side[] = [];

  for (const side of pieceA.sides) {
    if (side === snap.sideA) continue;
    remaining.push(toWorldSide(side, pieceA.transform));
  }

  for (const side of pieceB.sides) {
    if (side === snap.sideB) continue;
    remaining.push(toWorldSide(side, pieceB.transform));
  }

  const vertices = traceBoundary(remaining);
  const newPoly = polygon.create(vertices);
  const orderedSides = matchSidesToPoly(remaining, newPoly);

  return {
    id: newId,
    polygon: newPoly,
    transform: transform.identity(),
    sides: orderedSides,
    isPlaced: false,
    isFramePiece: false,
  };
}

function toWorldSide(side: Side, xform: AffineTransform): Side {
  return {
    id: side.id,
    ptA: transform.applyToPoint(xform, side.ptA),
    ptB: transform.applyToPoint(xform, side.ptB),
    attachable: side.attachable,
  };
}

function traceBoundary(sides: Side[]): Point[] {
  if (sides.length === 0) return [];

  const used = new Set<number>();
  const vertices: Point[] = [];

  let cur = sides[0];
  vertices.push({ x: cur.ptA.x, y: cur.ptA.y });
  used.add(0);

  for (let step = 1; step < sides.length; step++) {
    vertices.push({ x: cur.ptB.x, y: cur.ptB.y });

    let found = false;
    for (let i = 0; i < sides.length; i++) {
      if (used.has(i)) continue;
      if (point.equals(sides[i].ptA, cur.ptB)) {
        cur = sides[i];
        used.add(i);
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error('Cannot trace boundary: disconnected sides');
    }
  }

  return vertices;
}

function matchSidesToPoly(sides: Side[], poly: Polygon): Side[] {
  const verts = poly.vertices;
  const result: Side[] = [];
  const used = new Set<number>();

  for (let i = 0; i < verts.length; i++) {
    const vA = verts[i];
    const vB = verts[(i + 1) % verts.length];

    for (let j = 0; j < sides.length; j++) {
      if (used.has(j)) continue;
      if (point.equals(sides[j].ptA, vA) && point.equals(sides[j].ptB, vB)) {
        result.push(sides[j]);
        used.add(j);
        break;
      }
    }
  }

  return result;
}
