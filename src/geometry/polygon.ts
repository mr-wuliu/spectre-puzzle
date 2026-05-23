import type { Point } from './point';
import {
  subtract,
  rotateAround,
  distance,
  cross,
} from './point';

export interface Polygon {
  readonly vertices: readonly Point[];
}

export function create(vertices: Point[]): Polygon {
  if (vertices.length < 3) {
    throw new Error(`Polygon requires at least 3 vertices, got ${vertices.length}`);
  }
  return { vertices: vertices.map(v => ({ x: v.x, y: v.y })) };
}

export function numVertices(polygon: Polygon): number {
  return polygon.vertices.length;
}

export function clone(polygon: Polygon): Polygon {
  return { vertices: polygon.vertices.map(v => ({ x: v.x, y: v.y })) };
}

export function area(polygon: Polygon): number {
  const verts = polygon.vertices;
  let sum = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return sum / 2;
}

export function centroid(polygon: Polygon): Point {
  const verts = polygon.vertices;
  const n = verts.length;
  const a = area(polygon);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const crossVal = verts[i].x * verts[j].y - verts[j].x * verts[i].y;
    cx += (verts[i].x + verts[j].x) * crossVal;
    cy += (verts[i].y + verts[j].y) * crossVal;
  }
  const factor = 1 / (6 * a);
  return { x: cx * factor, y: cy * factor };
}

export function boundingBox(polygon: Polygon): { min: Point; max: Point } {
  const verts = polygon.vertices;
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function containsPoint(polygon: Polygon, point: Point): boolean {
  const verts = polygon.vertices;
  const n = verts.length;
  let winding = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const vi = verts[i];
    const vj = verts[j];
    if (vi.y <= point.y) {
      if (vj.y > point.y) {
        if (cross(subtract(vj, vi), subtract(point, vi)) > 0) {
          winding++;
        }
      }
    } else {
      if (vj.y <= point.y) {
        if (cross(subtract(vj, vi), subtract(point, vi)) < 0) {
          winding--;
        }
      }
    }
  }
  return winding !== 0;
}

export function translate(polygon: Polygon, dx: number, dy: number): Polygon {
  return {
    vertices: polygon.vertices.map(v => ({ x: v.x + dx, y: v.y + dy })),
  };
}

export function rotate(polygon: Polygon, angle: number, center?: Point): Polygon {
  const c = center ?? { x: 0, y: 0 };
  return {
    vertices: polygon.vertices.map(v => rotateAround(v, c, angle)),
  };
}

export function scale(polygon: Polygon, sx: number, sy: number, center?: Point): Polygon {
  const c = center ?? { x: 0, y: 0 };
  return {
    vertices: polygon.vertices.map(v => {
      const dx = v.x - c.x;
      const dy = v.y - c.y;
      return { x: c.x + dx * sx, y: c.y + dy * sy };
    }),
  };
}

export function edges(polygon: Polygon): { from: Point; to: Point }[] {
  const verts = polygon.vertices;
  const n = verts.length;
  const result: { from: Point; to: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    result.push({ from: { x: verts[i].x, y: verts[i].y }, to: { x: verts[j].x, y: verts[j].y } });
  }
  return result;
}

export function perimeter(polygon: Polygon): number {
  const verts = polygon.vertices;
  const n = verts.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += distance(verts[i], verts[j]);
  }
  return sum;
}
