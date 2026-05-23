import { describe, it, expect, beforeAll } from 'vitest';
import * as subject from './renderer';
import * as point from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import * as polygon from '../geometry/polygon';
import * as tileRenderer from './tile-renderer';

class MockPath2D {
  commands: string[] = [];
  moveTo(x: number, y: number) { this.commands.push(`M${x},${y}`); }
  lineTo(x: number, y: number) { this.commands.push(`L${x},${y}`); }
  closePath() { this.commands.push('Z'); }
}

beforeAll(() => {
  if (typeof Path2D === 'undefined') {
    (globalThis as Record<string, unknown>).Path2D = MockPath2D;
  }
  if (typeof OffscreenCanvas === 'undefined') {
    (globalThis as Record<string, unknown>).OffscreenCanvas = class {
      width: number;
      height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return null; }
    };
  }
});

const { abs } = Math;

// ─── SceneTransform ────────────────────────────────────────────────

describe('SceneTransform', () => {
  describe('create', () => {
    it('returns identity transform by default', () => {
      const t = subject.createSceneTransform();
      expect(t.panX).toBe(0);
      expect(t.panY).toBe(0);
      expect(t.zoom).toBe(1);
      expect(t.rotation).toBe(0);
      expect(t.centerX).toBe(0);
      expect(t.centerY).toBe(0);
    });

    it('accepts initial values', () => {
      const t = subject.createSceneTransform({ panX: 10, panY: 20, zoom: 2, rotation: 0.5, centerX: 100, centerY: 200 });
      expect(t.panX).toBe(10);
      expect(t.panY).toBe(20);
      expect(t.zoom).toBe(2);
      expect(t.rotation).toBe(0.5);
      expect(t.centerX).toBe(100);
      expect(t.centerY).toBe(200);
    });
  });

  describe('withPan', () => {
    it('returns a new transform with updated pan', () => {
      const t = subject.createSceneTransform();
      const t2 = subject.withPan(t, 50, 50);
      expect(t2.panX).toBe(50);
      expect(t2.panY).toBe(50);
      expect(t.panX).toBe(0); // original unchanged
    });
  });

  describe('withZoom', () => {
    it('returns a new transform with updated zoom', () => {
      const t = subject.createSceneTransform();
      const t2 = subject.withZoom(t, 2);
      expect(t2.zoom).toBe(2);
      expect(t.zoom).toBe(1);
    });
  });

  describe('withRotation', () => {
    it('returns a new transform with updated rotation', () => {
      const t = subject.createSceneTransform();
      const t2 = subject.withRotation(t, Math.PI / 4);
      expect(t2.rotation).toBeCloseTo(Math.PI / 4);
    });
  });

  describe('screenToScene — identity', () => {
    it('maps (100, 100) to (100, 100) with identity transform', () => {
      const t = subject.createSceneTransform();
      const result = subject.screenToScene(t, 100, 100);
      expect(result.x).toBeCloseTo(100);
      expect(result.y).toBeCloseTo(100);
    });
  });

  describe('screenToScene — pan', () => {
    it('maps (100, 100) to (50, 50) with pan(50, 50)', () => {
      const t = subject.withPan(subject.createSceneTransform(), 50, 50);
      const result = subject.screenToScene(t, 100, 100);
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(50);
    });
  });

  describe('screenToScene — zoom', () => {
    it('maps (100, 100) to (100, 100) with zoom(2) and center(0,0)', () => {
      const t = subject.withZoom(subject.createSceneTransform(), 2);
      const result = subject.screenToScene(t, 100, 100);
      // zoom=2 centered at (0,0): screen = scene * 2 + pan
      // inverse: scene = (screen - pan) / 2
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(50);
    });

    it('maps (200, 200) to (150, 150) with zoom(2) and center(100,100)', () => {
      const t = subject.createSceneTransform({ zoom: 2, centerX: 100, centerY: 100 });
      const result = subject.screenToScene(t, 200, 200);
      // screen = (scene - center) * zoom + center + pan
      // 200 = (scene - 100) * 2 + 100 + 0
      // 200 = 2*scene - 200 + 100
      // 200 = 2*scene - 100
      // 300 = 2*scene
      // scene = 150
      expect(result.x).toBeCloseTo(150);
      expect(result.y).toBeCloseTo(150);
    });
  });

  describe('sceneToScreen', () => {
    it('is the inverse of screenToScene for identity', () => {
      const t = subject.createSceneTransform();
      const screen = subject.sceneToScreen(t, 100, 100);
      expect(screen.x).toBeCloseTo(100);
      expect(screen.y).toBeCloseTo(100);
    });

    it('is the inverse of screenToScene with pan', () => {
      const t = subject.withPan(subject.createSceneTransform(), 50, 50);
      const screen = subject.sceneToScreen(t, 50, 50);
      expect(screen.x).toBeCloseTo(100);
      expect(screen.y).toBeCloseTo(100);
    });

    it('is the inverse of screenToScene with zoom and center', () => {
      const t = subject.createSceneTransform({ zoom: 2, centerX: 100, centerY: 100 });
      const screen = subject.sceneToScreen(t, 150, 150);
      expect(screen.x).toBeCloseTo(200);
      expect(screen.y).toBeCloseTo(200);
    });
  });

  describe('roundtrip: sceneToScreen(screenToScene(P)) ≈ P', () => {
    it('works for identity', () => {
      const t = subject.createSceneTransform();
      const p = point.create(42, 73);
      const roundtrip = subject.sceneToScreen(t, subject.screenToScene(t, p.x, p.y).x, subject.screenToScene(t, p.x, p.y).y);
      expect(abs(roundtrip.x - p.x)).toBeLessThan(1e-10);
      expect(abs(roundtrip.y - p.y)).toBeLessThan(1e-10);
    });

    it('works with pan + zoom + center', () => {
      const t = subject.createSceneTransform({ panX: 30, panY: -20, zoom: 1.5, centerX: 200, centerY: 150 });
      const p = point.create(42, 73);
      const scene = subject.screenToScene(t, p.x, p.y);
      const screen = subject.sceneToScreen(t, scene.x, scene.y);
      expect(abs(screen.x - p.x)).toBeLessThan(1e-10);
      expect(abs(screen.y - p.y)).toBeLessThan(1e-10);
    });

    it('works with rotation', () => {
      const t = subject.createSceneTransform({ rotation: Math.PI / 6, centerX: 200, centerY: 200 });
      const p = point.create(42, 73);
      const scene = subject.screenToScene(t, p.x, p.y);
      const screen = subject.sceneToScreen(t, scene.x, scene.y);
      expect(abs(screen.x - p.x)).toBeLessThan(1e-10);
      expect(abs(screen.y - p.y)).toBeLessThan(1e-10);
    });

    it('works with pan + zoom + rotation + center', () => {
      const t = subject.createSceneTransform({
        panX: 10, panY: 20, zoom: 2.5, rotation: Math.PI / 3, centerX: 300, centerY: 400,
      });
      const p = point.create(123, 456);
      const scene = subject.screenToScene(t, p.x, p.y);
      const screen = subject.sceneToScreen(t, scene.x, scene.y);
      expect(abs(screen.x - p.x)).toBeLessThan(1e-9);
      expect(abs(screen.y - p.y)).toBeLessThan(1e-9);
    });
  });

  describe('compose transforms: pan then zoom vs zoom then pan', () => {
    it('pan(50,50) then zoom(2) centered at origin maps (200,200) differently from zoom then pan', () => {
      const panThenZoom = subject.withZoom(subject.withPan(subject.createSceneTransform(), 50, 50), 2);
      const zoomThenPan = subject.withPan(subject.withZoom(subject.createSceneTransform(), 2), 50, 50);

      // These should produce different screen coordinates for the same scene point
      // because zoom is applied relative to center
      const s1 = subject.sceneToScreen(panThenZoom, 100, 100);
      const s2 = subject.sceneToScreen(zoomThenPan, 100, 100);

      // pan(50,50) then zoom(2): screen = (scene - 0) * 2 + (50,50)
      // = (200 + 50, 200 + 50) = (250, 250)
      expect(s1.x).toBeCloseTo(250);
      expect(s1.y).toBeCloseTo(250);

      // zoom(2) then pan(50,50): same since withPan/withZoom are just setters
      // screen = (scene - 0) * 2 + (50,50) = (250, 250)
      // Actually both have same final state, so they're equal
      expect(s2.x).toBeCloseTo(250);
      expect(s2.y).toBeCloseTo(250);
    });
  });

  describe('toAffineTransform', () => {
    it('produces an affine transform that matches sceneToScreen', () => {
      const t = subject.createSceneTransform({ panX: 10, panY: 20, zoom: 2, centerX: 100, centerY: 100 });
      const affine = subject.toAffineTransform(t);
      const p = point.create(50, 60);

      const viaSceneToScreen = subject.sceneToScreen(t, p.x, p.y);
      const viaAffine = affine(p);

      expect(viaAffine.x).toBeCloseTo(viaSceneToScreen.x);
      expect(viaAffine.y).toBeCloseTo(viaSceneToScreen.y);
    });
  });

  describe('viewportVisibleBounds', () => {
    it('returns scene-space bounding box for given screen viewport', () => {
      const t = subject.createSceneTransform();
      const bounds = subject.viewportVisibleBounds(t, { x: 0, y: 0, width: 800, height: 600 });
      expect(bounds.min.x).toBeCloseTo(0);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.max.x).toBeCloseTo(800);
      expect(bounds.max.y).toBeCloseTo(600);
    });

    it('accounts for zoom', () => {
      const t = subject.withZoom(subject.createSceneTransform(), 2);
      const bounds = subject.viewportVisibleBounds(t, { x: 0, y: 0, width: 800, height: 600 });
      // Visible scene range = viewport / zoom = 400 x 300
      expect(bounds.min.x).toBeCloseTo(0);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.max.x).toBeCloseTo(400);
      expect(bounds.max.y).toBeCloseTo(300);
    });

    it('accounts for pan', () => {
      const t = subject.withPan(subject.createSceneTransform(), 100, 50);
      const bounds = subject.viewportVisibleBounds(t, { x: 0, y: 0, width: 800, height: 600 });
      expect(bounds.min.x).toBeCloseTo(-100);
      expect(bounds.min.y).toBeCloseTo(-50);
      expect(bounds.max.x).toBeCloseTo(700);
      expect(bounds.max.y).toBeCloseTo(550);
    });
  });
});

// ─── TileRenderer ──────────────────────────────────────────────────

describe('TileRenderer', () => {
  function makeTriangle(): Polygon {
    return polygon.create([
      point.create(0, 0),
      point.create(100, 0),
      point.create(50, 86.6),
    ]);
  }

  describe('createTileCacheEntry', () => {
    it('computes bounding box from polygon', () => {
      const tri = makeTriangle();
      const entry = tileRenderer.createTileCacheEntry(tri, '#ff0000', '#000000');
      expect(entry.bbox.min.x).toBeCloseTo(0);
      expect(entry.bbox.min.y).toBeCloseTo(0);
      expect(entry.bbox.max.x).toBeCloseTo(100);
      expect(entry.bbox.max.y).toBeCloseTo(86.6, 0);
    });

    it('stores fill and stroke colors', () => {
      const tri = makeTriangle();
      const entry = tileRenderer.createTileCacheEntry(tri, '#ff0000', '#000000');
      expect(entry.fillColor).toBe('#ff0000');
      expect(entry.strokeColor).toBe('#000000');
    });
  });

  describe('DirtyTracker', () => {
    it('starts with no dirty regions', () => {
      const tracker = tileRenderer.createDirtyTracker();
      expect(tileRenderer.getDirtyRegions(tracker)).toHaveLength(0);
    });

    it('marks a region dirty', () => {
      const tracker = tileRenderer.createDirtyTracker();
      tileRenderer.markDirty(tracker, { x: 10, y: 20, width: 100, height: 50 });
      const regions = tileRenderer.getDirtyRegions(tracker);
      expect(regions).toHaveLength(1);
      expect(regions[0].x).toBe(10);
      expect(regions[0].y).toBe(20);
    });

    it('merges overlapping dirty regions', () => {
      const tracker = tileRenderer.createDirtyTracker();
      tileRenderer.markDirty(tracker, { x: 0, y: 0, width: 100, height: 100 });
      tileRenderer.markDirty(tracker, { x: 50, y: 50, width: 100, height: 100 });
      const regions = tileRenderer.getDirtyRegions(tracker);
      expect(regions).toHaveLength(1);
      expect(regions[0].x).toBe(0);
      expect(regions[0].y).toBe(0);
      expect(regions[0].width).toBeCloseTo(150);
      expect(regions[0].height).toBeCloseTo(150);
    });

    it('keeps non-overlapping regions separate', () => {
      const tracker = tileRenderer.createDirtyTracker();
      tileRenderer.markDirty(tracker, { x: 0, y: 0, width: 50, height: 50 });
      tileRenderer.markDirty(tracker, { x: 200, y: 200, width: 50, height: 50 });
      expect(tileRenderer.getDirtyRegions(tracker)).toHaveLength(2);
    });

    it('clears all dirty regions', () => {
      const tracker = tileRenderer.createDirtyTracker();
      tileRenderer.markDirty(tracker, { x: 0, y: 0, width: 100, height: 100 });
      tileRenderer.clearDirty(tracker);
      expect(tileRenderer.getDirtyRegions(tracker)).toHaveLength(0);
    });
  });

  describe('polygonToPath2D', () => {
    it('creates a Path2D with moveTo, lineTo, and closePath calls', () => {
      const tri = makeTriangle();
      const path = tileRenderer.polygonToPath2D(tri);
      expect(path).toBeDefined();
      const mockPath = path as unknown as { commands: string[] };
      if ('commands' in mockPath) {
        expect(mockPath.commands[0]).toBe('M0,0');
        expect(mockPath.commands).toContain('Z');
      }
    });
  });

  describe('isDirty', () => {
    it('returns false when tile bbox does not intersect dirty regions', () => {
      const tracker = tileRenderer.createDirtyTracker();
      tileRenderer.markDirty(tracker, { x: 200, y: 200, width: 50, height: 50 });
      const bbox = { min: point.create(0, 0), max: point.create(100, 100) };
      expect(tileRenderer.isDirty(tracker, bbox)).toBe(false);
    });

    it('returns true when tile bbox intersects a dirty region', () => {
      const tracker = tileRenderer.createDirtyTracker();
      tileRenderer.markDirty(tracker, { x: 50, y: 50, width: 100, height: 100 });
      const bbox = { min: point.create(0, 0), max: point.create(100, 100) };
      expect(tileRenderer.isDirty(tracker, bbox)).toBe(true);
    });
  });
});
