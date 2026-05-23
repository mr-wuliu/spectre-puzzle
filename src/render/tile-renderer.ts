import type { Point } from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import * as polygon from '../geometry/polygon';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileCacheEntry {
  polygon: Polygon;
  fillColor: string;
  strokeColor: string;
  bbox: { min: Point; max: Point };
  canvas: OffscreenCanvas | null;
  path: Path2D;
}

export interface DirtyTracker {
  regions: Rect[];
}

export function polygonToPath2D(poly: Polygon): Path2D {
  const path = new Path2D();
  const verts = poly.vertices;
  if (verts.length === 0) return path;
  path.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    path.lineTo(verts[i].x, verts[i].y);
  }
  path.closePath();
  return path;
}

export function createTileCacheEntry(
  poly: Polygon,
  fillColor: string,
  strokeColor: string,
): TileCacheEntry {
  const bbox = polygon.boundingBox(poly);
  const path = polygonToPath2D(poly);

  let canvas: OffscreenCanvas | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const padding = 2;
    const w = Math.ceil(bbox.max.x - bbox.min.x) + padding * 2;
    const h = Math.ceil(bbox.max.y - bbox.min.y) + padding * 2;
    canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.translate(-bbox.min.x + padding, -bbox.min.y + padding);
      drawPolygonToCtx(ctx, path, fillColor, strokeColor);
    }
  }

  return { polygon: poly, fillColor, strokeColor, bbox, canvas, path };
}

function drawPolygonToCtx(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  path: Path2D,
  fillColor: string,
  strokeColor: string,
): void {
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.fill(path);
  ctx.stroke(path);
}

export function drawTile(
  ctx: CanvasRenderingContext2D,
  entry: TileCacheEntry,
  position: Point,
): void {
  if (entry.canvas) {
    ctx.drawImage(
      entry.canvas,
      position.x + entry.bbox.min.x - 2,
      position.y + entry.bbox.min.y - 2,
    );
  } else {
    const saved = ctx.save();
    try {
      ctx.translate(position.x, position.y);
      drawPolygonToCtx(ctx, entry.path, entry.fillColor, entry.strokeColor);
    } finally {
      ctx.restore();
    }
  }
}

export function invalidateTile(entry: TileCacheEntry): TileCacheEntry {
  return createTileCacheEntry(entry.polygon, entry.fillColor, entry.strokeColor);
}

export function createDirtyTracker(): DirtyTracker {
  return { regions: [] };
}

export function markDirty(tracker: DirtyTracker, rect: Rect): void {
  for (let i = 0; i < tracker.regions.length; i++) {
    const existing = tracker.regions[i];
    if (rectsOverlap(existing, rect)) {
      tracker.regions[i] = unionRects(existing, rect);
      return;
    }
  }
  tracker.regions.push({ ...rect });
}

export function getDirtyRegions(tracker: DirtyTracker): Rect[] {
  return tracker.regions;
}

export function clearDirty(tracker: DirtyTracker): void {
  tracker.regions.length = 0;
}

export function isDirty(
  tracker: DirtyTracker,
  bbox: { min: Point; max: Point },
): boolean {
  return tracker.regions.some((r) =>
    rectsOverlap(r, rectFromBBox(bbox)),
  );
}

function rectFromBBox(bbox: { min: Point; max: Point }): Rect {
  return {
    x: bbox.min.x,
    y: bbox.min.y,
    width: bbox.max.x - bbox.min.x,
    height: bbox.max.y - bbox.min.y,
  };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function unionRects(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
