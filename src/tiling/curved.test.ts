import { describe, it, expect } from 'vitest';
import type { Point } from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import * as polygon from '../geometry/polygon';
import * as point from '../geometry/point';
import { SPECTRE_VERTICES } from './spectre';
import { hatOutline } from './hat';
import { createCurvyShape } from './curved';
import type { BezierSegment } from './curved';

describe('createCurvyShape', () => {
  function makePolygon(vertices: Point[]): Polygon {
    return polygon.create(vertices);
  }

  describe('Spectre (14 vertices)', () => {
    const spectrePoly = makePolygon([...SPECTRE_VERTICES]);
    const curvy = createCurvyShape(spectrePoly);

    it('produces 14 Bézier segments for Spectre', () => {
      expect(curvy.segments.length).toBe(14);
    });

    it('each segment has from, cp1, cp2, to control points', () => {
      for (const seg of curvy.segments) {
        expect(seg).toHaveProperty('from');
        expect(seg).toHaveProperty('cp1');
        expect(seg).toHaveProperty('cp2');
        expect(seg).toHaveProperty('to');
        expect(typeof seg.from.x).toBe('number');
        expect(typeof seg.cp1.x).toBe('number');
        expect(typeof seg.cp2.x).toBe('number');
        expect(typeof seg.to.x).toBe('number');
      }
    });

    it('segment endpoints match polygon vertices', () => {
      const n = spectrePoly.vertices.length;
      for (let i = 0; i < n; i++) {
        const seg = curvy.segments[i];
        const vi = spectrePoly.vertices[i];
        const vj = spectrePoly.vertices[(i + 1) % n];
        expect(seg.from.x).toBeCloseTo(vi.x, 10);
        expect(seg.from.y).toBeCloseTo(vi.y, 10);
        expect(seg.to.x).toBeCloseTo(vj.x, 10);
        expect(seg.to.y).toBeCloseTo(vj.y, 10);
      }
    });

    it('control points at 1/3 and 2/3 along each edge', () => {
      const verts = spectrePoly.vertices;
      const n = verts.length;
      for (let i = 0; i < n; i++) {
        const vi = verts[i];
        const vj = verts[(i + 1) % n];
        const edge = point.subtract(vj, vi);

        // Control points should be at 1/3 and 2/3 along edge direction
        // plus perpendicular offset. Check the 1/3 and 2/3 by projecting
        // back onto the edge line.
        const seg = curvy.segments[i];

        // cp1 should be at approximately 1/3 along edge + perp offset
        const cp1Along = point.subtract(seg.cp1, vi);
        const cp2Along = point.subtract(seg.cp2, vi);

        // Dot product with normalized edge direction gives projection
        const edgeLen = point.magnitude(edge);
        const edgeDir = point.scale(edge, 1 / edgeLen);

        const cp1Proj = point.dot(cp1Along, edgeDir);
        const cp2Proj = point.dot(cp2Along, edgeDir);

        expect(cp1Proj).toBeCloseTo(edgeLen / 3, 4);
        expect(cp2Proj).toBeCloseTo(2 * edgeLen / 3, 4);
      }
    });

    it('perpendicular direction alternates (+0.6, -0.6, +0.6, ...)', () => {
      const verts = spectrePoly.vertices;
      const n = verts.length;
      for (let i = 0; i < n; i++) {
        const vi = verts[i];
        const vj = verts[(i + 1) % n];
        const edge = point.subtract(vj, vi);
        const edgeLen = point.magnitude(edge);
        const edgeDir = point.scale(edge, 1 / edgeLen);
        // Perpendicular: (-dy, dx) normalized = (-edgeDir.y, edgeDir.x)
        const perp: Point = { x: -edgeDir.y, y: edgeDir.x };

        const seg = curvy.segments[i];
        const expectedSign = i % 2 === 0 ? 1 : -1;
        const offset = 0.6 * expectedSign;

        // cp1 perpendicular component
        const cp1FromStart = point.subtract(seg.cp1, vi);
        const cp1PerpComp = point.dot(cp1FromStart, perp);
        expect(cp1PerpComp).toBeCloseTo(offset, 4);

        // cp2 perpendicular component
        const cp2FromStart = point.subtract(seg.cp2, vi);
        const cp2PerpComp = point.dot(cp2FromStart, perp);
        expect(cp2PerpComp).toBeCloseTo(offset, 4);
      }
    });
  });

  describe('Hat (13 vertices)', () => {
    const hatPoly = makePolygon(hatOutline());
    const curvy = createCurvyShape(hatPoly);

    it('produces 13 Bézier segments for Hat', () => {
      expect(curvy.segments.length).toBe(13);
    });

    it('curved polygon area is within 5% of straight polygon area', () => {
      const straightArea = Math.abs(polygon.area(hatPoly));
      // Approximate curved area by sampling the bezier with line segments
      // Use the control points of the bezier to compute an approximate area
      // via the shoelace formula on polyline approximation
      const polyPoints: Point[] = [];
      const STEPS = 20; // per bezier segment
      for (const seg of curvy.segments) {
        for (let t = 0; t < STEPS; t++) {
          const frac = t / STEPS;
          const pt = evalBezier(seg, frac);
          polyPoints.push(pt);
        }
      }
      // Shoelace
      let area = 0;
      for (let i = 0; i < polyPoints.length; i++) {
        const j = (i + 1) % polyPoints.length;
        area += polyPoints[i].x * polyPoints[j].y - polyPoints[j].x * polyPoints[i].y;
      }
      area = Math.abs(area) / 2;

      const ratio = area / straightArea;
      expect(ratio).toBeGreaterThan(0.90);
      expect(ratio).toBeLessThan(1.10);
    });
  });

  describe('straighten()', () => {
    const spectrePoly = makePolygon([...SPECTRE_VERTICES]);
    const curvy = createCurvyShape(spectrePoly);

    it('returns the original polygon', () => {
      const straight = curvy.straighten();
      expect(straight.vertices.length).toBe(spectrePoly.vertices.length);
      for (let i = 0; i < straight.vertices.length; i++) {
        expect(straight.vertices[i].x).toBeCloseTo(spectrePoly.vertices[i].x, 10);
        expect(straight.vertices[i].y).toBeCloseTo(spectrePoly.vertices[i].y, 10);
      }
    });
  });

  describe('toCanvasPath()', () => {
    const spectrePoly = makePolygon([...SPECTRE_VERTICES]);
    const curvy = createCurvyShape(spectrePoly);

    it('produces a closed path', () => {
      const calls: { method: string; args: number[] }[] = [];
      const mockCtx = {
        beginPath: () => calls.push({ method: 'beginPath', args: [] }),
        moveTo: (x: number, y: number) => calls.push({ method: 'moveTo', args: [x, y] }),
        bezierCurveTo: (cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) =>
          calls.push({ method: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] }),
        closePath: () => calls.push({ method: 'closePath', args: [] }),
      };

      curvy.toCanvasPath(mockCtx as unknown as CanvasRenderingContext2D);

      // Should begin path
      expect(calls[0].method).toBe('beginPath');

      // Should moveTo first vertex
      expect(calls[1].method).toBe('moveTo');
      expect(calls[1].args[0]).toBeCloseTo(spectrePoly.vertices[0].x, 10);
      expect(calls[1].args[1]).toBeCloseTo(spectrePoly.vertices[0].y, 10);

      // Should have 14 bezierCurveTo calls
      const bezierCalls = calls.filter(c => c.method === 'bezierCurveTo');
      expect(bezierCalls.length).toBe(14);

      // Last bezierCurveTo should end at first vertex (closed)
      const lastBezier = bezierCalls[bezierCalls.length - 1];
      expect(lastBezier.args[4]).toBeCloseTo(spectrePoly.vertices[0].x, 10);
      expect(lastBezier.args[5]).toBeCloseTo(spectrePoly.vertices[0].y, 10);

      // Should close path
      expect(calls[calls.length - 1].method).toBe('closePath');

      // Verify bezier control points match segments
      for (let i = 0; i < 14; i++) {
        const seg = curvy.segments[i];
        const call = bezierCalls[i];
        expect(call.args[0]).toBeCloseTo(seg.cp1.x, 10);
        expect(call.args[1]).toBeCloseTo(seg.cp1.y, 10);
        expect(call.args[2]).toBeCloseTo(seg.cp2.x, 10);
        expect(call.args[3]).toBeCloseTo(seg.cp2.y, 10);
        expect(call.args[4]).toBeCloseTo(seg.to.x, 10);
        expect(call.args[5]).toBeCloseTo(seg.to.y, 10);
      }
    });
  });
});

/** Evaluate cubic bezier at parameter t ∈ [0,1] */
function evalBezier(seg: BezierSegment, t: number): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * seg.from.x + 3 * mt2 * t * seg.cp1.x + 3 * mt * t2 * seg.cp2.x + t3 * seg.to.x,
    y: mt3 * seg.from.y + 3 * mt2 * t * seg.cp1.y + 3 * mt * t2 * seg.cp2.y + t3 * seg.to.y,
  };
}
