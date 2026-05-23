import type { Point } from './point';
import type { Polygon } from './polygon';
import { create as createPoly } from './polygon';

export interface AffineTransform {
  readonly matrix: readonly [number, number, number, number, number, number, number, number, number];
}

const { cos, sin, abs } = Math;

export function identity(): AffineTransform {
  return { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

export function translation(tx: number, ty: number): AffineTransform {
  return { matrix: [1, 0, tx, 0, 1, ty, 0, 0, 1] };
}

export function rotation(angle: number): AffineTransform {
  const c = cos(angle);
  const s = sin(angle);
  return { matrix: [c, -s, 0, s, c, 0, 0, 0, 1] };
}

export function scaling(sx: number, sy: number): AffineTransform {
  return { matrix: [sx, 0, 0, 0, sy, 0, 0, 0, 1] };
}

export function compose(a: AffineTransform, b: AffineTransform): AffineTransform {
  const m = a.matrix;
  const n = b.matrix;
  return {
    matrix: [
      m[0]*n[0] + m[1]*n[3] + m[2]*n[6],
      m[0]*n[1] + m[1]*n[4] + m[2]*n[7],
      m[0]*n[2] + m[1]*n[5] + m[2]*n[8],
      m[3]*n[0] + m[4]*n[3] + m[5]*n[6],
      m[3]*n[1] + m[4]*n[4] + m[5]*n[7],
      m[3]*n[2] + m[4]*n[5] + m[5]*n[8],
      0, 0, 1,
    ],
  };
}

export function applyToPoint(t: AffineTransform, p: Point): Point {
  const m = t.matrix;
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}

export function applyToPolygon(t: AffineTransform, poly: Polygon): Polygon {
  return createPoly(poly.vertices.map(v => applyToPoint(t, v)));
}

export function inverse(t: AffineTransform): AffineTransform {
  const m = t.matrix;
  const det = m[0] * m[4] - m[1] * m[3];
  const invDet = 1 / det;
  return {
    matrix: [
      m[4] * invDet,
      -m[1] * invDet,
      (m[1] * m[5] - m[2] * m[4]) * invDet,
      -m[3] * invDet,
      m[0] * invDet,
      (m[2] * m[3] - m[0] * m[5]) * invDet,
      0, 0, 1,
    ],
  };
}

export function equals(a: AffineTransform, b: AffineTransform, epsilon: number = 1e-10): boolean {
  for (let i = 0; i < 9; i++) {
    if (abs(a.matrix[i] - b.matrix[i]) >= epsilon) return false;
  }
  return true;
}
