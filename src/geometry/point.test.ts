import { describe, it, expect } from 'vitest';
import {
  create,
  add,
  subtract,
  scale,
  rotate,
  rotateAround,
  distance,
  dot,
  cross,
  lerp,
  magnitude,
  normalize,
  equals,
} from './point';

const PI = Math.PI;
const { sqrt, abs } = Math;

describe('Point', () => {
  describe('create', () => {
    it('creates a point with given coordinates', () => {
      const p = create(3, 4);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    });

    it('creates a point at origin', () => {
      const p = create(0, 0);
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });

    it('creates a point with negative coordinates', () => {
      const p = create(-1.5, -2.5);
      expect(p.x).toBe(-1.5);
      expect(p.y).toBe(-2.5);
    });
  });

  describe('add', () => {
    it('adds two positive points', () => {
      const r = add(create(1, 2), create(3, 4));
      expect(r.x).toBe(4);
      expect(r.y).toBe(6);
    });

    it('adds with negative values', () => {
      const r = add(create(-1, -2), create(3, 4));
      expect(r.x).toBe(2);
      expect(r.y).toBe(2);
    });

    it('adds zero vector', () => {
      const p = create(5, 7);
      const r = add(p, create(0, 0));
      expect(r.x).toBe(5);
      expect(r.y).toBe(7);
    });
  });

  describe('subtract', () => {
    it('subtracts two points', () => {
      const r = subtract(create(5, 7), create(2, 3));
      expect(r.x).toBe(3);
      expect(r.y).toBe(4);
    });

    it('subtracting same point gives zero', () => {
      const p = create(3, 4);
      const r = subtract(p, p);
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
    });

    it('subtracting with negative values', () => {
      const r = subtract(create(1, 1), create(-2, -3));
      expect(r.x).toBe(3);
      expect(r.y).toBe(4);
    });
  });

  describe('scale', () => {
    it('scales by positive factor', () => {
      const r = scale(create(2, 3), 2);
      expect(r.x).toBe(4);
      expect(r.y).toBe(6);
    });

    it('scales by zero', () => {
      const r = scale(create(5, 7), 0);
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
    });

    it('scales by negative factor (reflects)', () => {
      const r = scale(create(2, 3), -1);
      expect(r.x).toBe(-2);
      expect(r.y).toBe(-3);
    });

    it('scales by fractional factor', () => {
      const r = scale(create(4, 6), 0.5);
      expect(r.x).toBe(2);
      expect(r.y).toBe(3);
    });
  });

  describe('rotate', () => {
    it('rotate by 0 returns same point', () => {
      const p = create(3, 4);
      const r = rotate(p, 0);
      expect(equals(r, p)).toBe(true);
    });

    it('rotate (1,0) by 90° gives (0,1)', () => {
      const r = rotate(create(1, 0), PI / 2);
      expect(abs(r.x)).toBeLessThan(1e-10);
      expect(abs(r.y - 1)).toBeLessThan(1e-10);
    });

    it('rotate (1,0) by 180° gives (-1,0)', () => {
      const r = rotate(create(1, 0), PI);
      expect(abs(r.x + 1)).toBeLessThan(1e-10);
      expect(abs(r.y)).toBeLessThan(1e-10);
    });

    it('rotate (1,0) by 360° gives (1,0)', () => {
      const r = rotate(create(1, 0), 2 * PI);
      expect(abs(r.x - 1)).toBeLessThan(1e-10);
      expect(abs(r.y)).toBeLessThan(1e-10);
    });

    it('rotate (0,1) by 90° gives (-1,0)', () => {
      const r = rotate(create(0, 1), PI / 2);
      expect(abs(r.x + 1)).toBeLessThan(1e-10);
      expect(abs(r.y)).toBeLessThan(1e-10);
    });

    it('rotate (1,1) by 45° gives (0, sqrt2)', () => {
      const r = rotate(create(1, 1), PI / 4);
      expect(abs(r.x)).toBeLessThan(1e-10);
      expect(abs(r.y - sqrt(2))).toBeLessThan(1e-10);
    });
  });

  describe('rotateAround', () => {
    it('rotate around same point is identity', () => {
      const center = create(3, 4);
      const r = rotateAround(center, center, PI / 3);
      expect(equals(r, center)).toBe(true);
    });

    it('rotate (2,0) around (1,0) by 90° gives (1,1)', () => {
      const r = rotateAround(create(2, 0), create(1, 0), PI / 2);
      expect(abs(r.x - 1)).toBeLessThan(1e-10);
      expect(abs(r.y - 1)).toBeLessThan(1e-10);
    });

    it('rotate around origin matches rotate', () => {
      const p = create(3, 4);
      const angle = 1.23;
      const r1 = rotate(p, angle);
      const r2 = rotateAround(p, create(0, 0), angle);
      expect(equals(r1, r2)).toBe(true);
    });
  });

  describe('distance', () => {
    it('distance between same point is 0', () => {
      expect(distance(create(3, 4), create(3, 4))).toBe(0);
    });

    it('distance (0,0) to (3,4) is 5', () => {
      expect(distance(create(0, 0), create(3, 4))).toBe(5);
    });

    it('distance with negative coordinates', () => {
      expect(distance(create(-1, -1), create(2, 3))).toBe(5);
    });
  });

  describe('dot', () => {
    it('dot product of perpendicular vectors is 0', () => {
      expect(dot(create(1, 0), create(0, 1))).toBe(0);
    });

    it('dot product of parallel vectors', () => {
      expect(dot(create(2, 3), create(2, 3))).toBe(13);
    });

    it('dot product is commutative', () => {
      const a = create(3, 4);
      const b = create(5, 6);
      expect(dot(a, b)).toBe(dot(b, a));
    });

    it('dot product of opposite vectors is negative', () => {
      expect(dot(create(1, 0), create(-1, 0))).toBe(-1);
    });
  });

  describe('cross', () => {
    it('cross product of parallel vectors is 0', () => {
      expect(cross(create(2, 3), create(4, 6))).toBe(0);
    });

    it('cross product of (1,0) and (0,1) is 1', () => {
      expect(cross(create(1, 0), create(0, 1))).toBe(1);
    });

    it('cross product is anti-commutative', () => {
      const a = create(3, 4);
      const b = create(5, 6);
      expect(cross(a, b)).toBe(-cross(b, a));
    });

    it('cross product gives signed area of parallelogram', () => {
      expect(cross(create(2, 0), create(0, 3))).toBe(6);
    });
  });

  describe('lerp', () => {
    it('lerp at t=0 returns a', () => {
      const a = create(1, 2);
      const b = create(5, 6);
      const r = lerp(a, b, 0);
      expect(equals(r, a)).toBe(true);
    });

    it('lerp at t=1 returns b', () => {
      const a = create(1, 2);
      const b = create(5, 6);
      const r = lerp(a, b, 1);
      expect(equals(r, b)).toBe(true);
    });

    it('lerp at t=0.5 returns midpoint', () => {
      const a = create(0, 0);
      const b = create(4, 6);
      const r = lerp(a, b, 0.5);
      expect(r.x).toBe(2);
      expect(r.y).toBe(3);
    });

    it('lerp extrapolates for t>1', () => {
      const a = create(0, 0);
      const b = create(1, 1);
      const r = lerp(a, b, 2);
      expect(r.x).toBe(2);
      expect(r.y).toBe(2);
    });

    it('lerp extrapolates for t<0', () => {
      const a = create(0, 0);
      const b = create(1, 1);
      const r = lerp(a, b, -1);
      expect(r.x).toBe(-1);
      expect(r.y).toBe(-1);
    });
  });

  describe('magnitude', () => {
    it('magnitude of zero is 0', () => {
      expect(magnitude(create(0, 0))).toBe(0);
    });

    it('magnitude of (3,4) is 5', () => {
      expect(magnitude(create(3, 4))).toBe(5);
    });

    it('magnitude of unit vector is 1', () => {
      expect(abs(magnitude(create(1, 0)) - 1)).toBeLessThan(1e-10);
    });
  });

  describe('normalize', () => {
    it('normalize (3,4) gives (0.6, 0.8)', () => {
      const r = normalize(create(3, 4));
      expect(abs(r.x - 0.6)).toBeLessThan(1e-10);
      expect(abs(r.y - 0.8)).toBeLessThan(1e-10);
    });

    it('normalized vector has magnitude 1', () => {
      const r = normalize(create(5, 12));
      expect(abs(magnitude(r) - 1)).toBeLessThan(1e-10);
    });

    it('normalize negative vector', () => {
      const r = normalize(create(-3, 0));
      expect(abs(r.x + 1)).toBeLessThan(1e-10);
      expect(abs(r.y)).toBeLessThan(1e-10);
    });
  });

  describe('equals', () => {
    it('same points are equal', () => {
      expect(equals(create(1, 2), create(1, 2))).toBe(true);
    });

    it('different points are not equal', () => {
      expect(equals(create(1, 2), create(1, 3))).toBe(false);
    });

    it('respects epsilon', () => {
      expect(equals(create(1, 2), create(1 + 1e-11, 2))).toBe(true);
      expect(equals(create(1, 2), create(1 + 1e-9, 2))).toBe(false);
    });

    it('custom epsilon', () => {
      expect(equals(create(1, 2), create(1.05, 2), 0.1)).toBe(true);
      expect(equals(create(1, 2), create(1.05, 2), 0.01)).toBe(false);
    });
  });
});
