import type { Point } from './point';
import type { Polygon } from './polygon';

export interface ClipRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const EPSILON = 1e-10;

type EdgeTest = (p: Point) => boolean;
type EdgeIntersect = (a: Point, b: Point) => Point;

function clipEdge(
  vertices: readonly Point[],
  isInside: EdgeTest,
  intersect: EdgeIntersect,
): Point[] {
  if (vertices.length === 0) return [];

  const output: Point[] = [];
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % n];
    const currentInside = isInside(current);
    const nextInside = isInside(next);

    if (currentInside) {
      output.push(current);
      if (!nextInside) {
        output.push(intersect(current, next));
      }
    } else if (nextInside) {
      output.push(intersect(current, next));
    }
  }

  return output;
}

function intersectVertical(a: Point, b: Point, edgeX: number): Point {
  const t = (edgeX - a.x) / (b.x - a.x);
  return { x: edgeX, y: a.y + t * (b.y - a.y) };
}

function intersectHorizontal(a: Point, b: Point, edgeY: number): Point {
  const t = (edgeY - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y: edgeY };
}

export function clipPolygon(polygon: Polygon, rect: ClipRect): Polygon {
  let vertices = polygon.vertices as readonly Point[];

  vertices = clipEdge(
    vertices,
    (p) => p.x >= rect.minX - EPSILON,
    (a, b) => intersectVertical(a, b, rect.minX),
  );

  vertices = clipEdge(
    vertices,
    (p) => p.x <= rect.maxX + EPSILON,
    (a, b) => intersectVertical(a, b, rect.maxX),
  );

  vertices = clipEdge(
    vertices,
    (p) => p.y >= rect.minY - EPSILON,
    (a, b) => intersectHorizontal(a, b, rect.minY),
  );

  vertices = clipEdge(
    vertices,
    (p) => p.y <= rect.maxY + EPSILON,
    (a, b) => intersectHorizontal(a, b, rect.maxY),
  );

  if (vertices.length < 3) {
    return { vertices: [] };
  }

  return { vertices };
}

export function isEmptyPolygon(polygon: Polygon): boolean {
  return polygon.vertices.length < 3;
}
