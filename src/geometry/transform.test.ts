import { describe, it, expect } from 'vitest';
import { create as pt, equals } from './point';
import { create as createPoly, area } from './polygon';
import {
  identity,
  translation,
  rotation,
  scaling,
  compose,
  applyToPoint,
  applyToPolygon,
  inverse,
  equals as txEquals,
} from './transform';
import type { AffineTransform } from './transform';

const PI = Math.PI;
const { abs } = Math;

describe('AffineTransform', () => {
  describe('identity', () => {
    it('apply to any point returns same point', () => {
      const t = identity();
      const p = pt(3, 4);
      const r = applyToPoint(t, p);
      expect(equals(r, p)).toBe(true);
    });

    it('apply to origin returns origin', () => {
      const t = identity();
      const r = applyToPoint(t, pt(0, 0));
      expect(equals(r, pt(0, 0))).toBe(true);
    });
  });

  describe('translation', () => {
    it('translate (0,0) by (5,3) gives (5,3)', () => {
      const t = translation(5, 3);
      const r = applyToPoint(t, pt(0, 0));
      expect(equals(r, pt(5, 3))).toBe(true);
    });

    it('translate preserves relative distances', () => {
      const t = translation(10, 20);
      const a = applyToPoint(t, pt(1, 2));
      const b = applyToPoint(t, pt(4, 6));
      expect(abs(a.x - b.x - (-3))).toBeLessThan(1e-10);
      expect(abs(a.y - b.y - (-4))).toBeLessThan(1e-10);
    });

    it('negative translation', () => {
      const t = translation(-5, -3);
      const r = applyToPoint(t, pt(5, 3));
      expect(equals(r, pt(0, 0))).toBe(true);
    });
  });

  describe('rotation', () => {
    it('rotate (1,0) by 90° gives (0,1)', () => {
      const t = rotation(PI / 2);
      const r = applyToPoint(t, pt(1, 0));
      expect(abs(r.x)).toBeLessThan(1e-10);
      expect(abs(r.y - 1)).toBeLessThan(1e-10);
    });

    it('rotate (0,1) by 90° gives (-1,0)', () => {
      const t = rotation(PI / 2);
      const r = applyToPoint(t, pt(0, 1));
      expect(abs(r.x + 1)).toBeLessThan(1e-10);
      expect(abs(r.y)).toBeLessThan(1e-10);
    });

    it('rotate by 180° negates', () => {
      const t = rotation(PI);
      const r = applyToPoint(t, pt(3, 4));
      expect(abs(r.x + 3)).toBeLessThan(1e-10);
      expect(abs(r.y + 4)).toBeLessThan(1e-10);
    });

    it('rotate by 360° is identity', () => {
      const t = rotation(2 * PI);
      const r = applyToPoint(t, pt(3, 4));
      expect(equals(r, pt(3, 4))).toBe(true);
    });
  });

  describe('scaling', () => {
    it('scale (2,3) by (2,2) gives (4,6)', () => {
      const t = scaling(2, 2);
      const r = applyToPoint(t, pt(2, 3));
      expect(equals(r, pt(4, 6))).toBe(true);
    });

    it('non-uniform scale', () => {
      const t = scaling(3, 0.5);
      const r = applyToPoint(t, pt(2, 4));
      expect(equals(r, pt(6, 2))).toBe(true);
    });

    it('scale by 1 is identity', () => {
      const t = scaling(1, 1);
      const r = applyToPoint(t, pt(5, 7));
      expect(equals(r, pt(5, 7))).toBe(true);
    });

    it('scale by -1 reflects', () => {
      const t = scaling(-1, -1);
      const r = applyToPoint(t, pt(3, 4));
      expect(equals(r, pt(-3, -4))).toBe(true);
    });
  });

  describe('compose', () => {
    it('compose with identity is no-op', () => {
      const t = translation(5, 3);
      const id = identity();
      const r = compose(id, t);
      const p = applyToPoint(r, pt(1, 2));
      expect(equals(p, pt(6, 5))).toBe(true);
    });

    it('translate then rotate differs from rotate then translate', () => {
      const p = pt(1, 0);
      const T = translation(0, 1);
      const R = rotation(PI / 2);

      const tr = applyToPoint(compose(T, R), p);
      const rt = applyToPoint(compose(R, T), p);

      // compose(T,R): apply R first then T: rotate (1,0)->(0,1), translate -> (0,2)
      expect(abs(tr.x)).toBeLessThan(1e-10);
      expect(abs(tr.y - 2)).toBeLessThan(1e-10);

      // compose(R,T): apply T first then R: translate (1,0)->(1,1), rotate 90° -> (-1,1)
      expect(abs(rt.x + 1)).toBeLessThan(1e-10);
      expect(abs(rt.y - 1)).toBeLessThan(1e-10);
    });

    it('double translation adds', () => {
      const t1 = translation(3, 4);
      const t2 = translation(1, 2);
      const t = compose(t1, t2);
      const r = applyToPoint(t, pt(0, 0));
      expect(equals(r, pt(4, 6))).toBe(true);
    });
  });

  describe('inverse', () => {
    it('inverse of identity is identity', () => {
      const id = identity();
      const inv = inverse(id);
      expect(txEquals(id, inv)).toBe(true);
    });

    it('inverse roundtrip: T^-1 * T ≈ identity', () => {
      const t = translation(5, 3);
      const inv = inverse(t);
      const composed = compose(inv, t);
      const r = applyToPoint(composed, pt(7, 11));
      expect(abs(r.x - 7)).toBeLessThan(1e-10);
      expect(abs(r.y - 11)).toBeLessThan(1e-10);
    });

    it('inverse of rotation', () => {
      const t = rotation(PI / 4);
      const inv = inverse(t);
      const composed = compose(inv, t);
      const r = applyToPoint(composed, pt(3, 4));
      expect(abs(r.x - 3)).toBeLessThan(1e-10);
      expect(abs(r.y - 4)).toBeLessThan(1e-10);
    });

    it('inverse of scaling', () => {
      const t = scaling(2, 3);
      const inv = inverse(t);
      const composed = compose(inv, t);
      const r = applyToPoint(composed, pt(5, 7));
      expect(abs(r.x - 5)).toBeLessThan(1e-10);
      expect(abs(r.y - 7)).toBeLessThan(1e-10);
    });

    it('inverse of composed transform', () => {
      const T = translation(5, 3);
      const R = rotation(PI / 6);
      const S = scaling(2, 3);
      const combined = compose(T, compose(R, S));
      const inv = inverse(combined);
      const roundtrip = compose(inv, combined);
      const r = applyToPoint(roundtrip, pt(10, 20));
      expect(abs(r.x - 10)).toBeLessThan(1e-10);
      expect(abs(r.y - 20)).toBeLessThan(1e-10);
    });
  });

  describe('applyToPolygon', () => {
    it('translates all vertices', () => {
      const poly = createPoly([pt(0, 0), pt(1, 0), pt(0, 1)]);
      const t = translation(5, 3);
      const moved = applyToPolygon(t, poly);
      expect(equals(moved.vertices[0], pt(5, 3))).toBe(true);
      expect(equals(moved.vertices[1], pt(6, 3))).toBe(true);
      expect(equals(moved.vertices[2], pt(5, 4))).toBe(true);
    });

    it('scales polygon area', () => {
      const poly = createPoly([pt(0, 0), pt(2, 0), pt(2, 2), pt(0, 2)]);
      const t = scaling(3, 3);
      const scaled = applyToPolygon(t, poly);
      expect(abs(area(scaled) - 36)).toBeLessThan(1e-10);
    });

    it('does not modify original', () => {
      const poly = createPoly([pt(0, 0), pt(1, 0), pt(0, 1)]);
      const t = translation(5, 5);
      applyToPolygon(t, poly);
      expect(equals(poly.vertices[0], pt(0, 0))).toBe(true);
    });
  });

  describe('equals', () => {
    it('identity equals identity', () => {
      expect(txEquals(identity(), identity())).toBe(true);
    });

    it('different transforms not equal', () => {
      expect(txEquals(translation(1, 0), translation(0, 1))).toBe(false);
    });

    it('respects epsilon', () => {
      const a = identity();
      const b = translation(1e-11, 1e-11);
      expect(txEquals(a, b, 1e-10)).toBe(true);
    });
  });
});
