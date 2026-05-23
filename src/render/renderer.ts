import type { Point } from '../geometry/point';
import * as transform from '../geometry/transform';

export interface SceneTransform {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly rotation: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const { cos, sin } = Math;

export function createSceneTransform(
  partial?: Partial<SceneTransform>,
): SceneTransform {
  return {
    panX: partial?.panX ?? 0,
    panY: partial?.panY ?? 0,
    zoom: partial?.zoom ?? 1,
    rotation: partial?.rotation ?? 0,
    centerX: partial?.centerX ?? 0,
    centerY: partial?.centerY ?? 0,
  };
}

export function withPan(t: SceneTransform, x: number, y: number): SceneTransform {
  return { ...t, panX: x, panY: y };
}

export function withZoom(t: SceneTransform, z: number): SceneTransform {
  return { ...t, zoom: z };
}

export function withRotation(t: SceneTransform, r: number): SceneTransform {
  return { ...t, rotation: r };
}

export function sceneToScreen(t: SceneTransform, x: number, y: number): Point {
  const dx = x - t.centerX;
  const dy = y - t.centerY;
  const rotatedX = dx * cos(t.rotation) - dy * sin(t.rotation);
  const rotatedY = dx * sin(t.rotation) + dy * cos(t.rotation);
  return {
    x: rotatedX * t.zoom + t.centerX + t.panX,
    y: rotatedY * t.zoom + t.centerY + t.panY,
  };
}

export function screenToScene(t: SceneTransform, x: number, y: number): Point {
  const unpannedX = x - t.panX - t.centerX;
  const unpannedY = y - t.panY - t.centerY;
  const unzoomedX = unpannedX / t.zoom;
  const unzoomedY = unpannedY / t.zoom;
  const unrotatedX = unzoomedX * cos(-t.rotation) - unzoomedY * sin(-t.rotation);
  const unrotatedY = unzoomedX * sin(-t.rotation) + unzoomedY * cos(-t.rotation);
  return {
    x: unrotatedX + t.centerX,
    y: unrotatedY + t.centerY,
  };
}

export function toAffineTransform(t: SceneTransform): (p: Point) => Point {
  return (p: Point) => sceneToScreen(t, p.x, p.y);
}

export function toAffineTransformObj(t: SceneTransform): transform.AffineTransform {
  const c = cos(t.rotation);
  const s = sin(t.rotation);
  const z = t.zoom;
  const cx = t.centerX;
  const cy = t.centerY;
  const px = t.panX;
  const py = t.panY;

  // Full transform: translate(-center) → rotate → scale → translate(center) → translate(pan)
  // Combined matrix:
  // [z*c, -z*s, cx + px - cx*z*c + cy*z*s]
  // [z*s,  z*c, cy + py - cx*z*s - cy*z*c]
  // [  0,    0,                                1]
  const tx = cx + px - cx * z * c + cy * z * s;
  const ty = cy + py - cx * z * s - cy * z * c;
  return {
    matrix: [z * c, -z * s, tx, z * s, z * c, ty, 0, 0, 1],
  };
}

export function viewportVisibleBounds(
  t: SceneTransform,
  viewport: Viewport,
): { min: Point; max: Point } {
  const corners = [
    screenToScene(t, viewport.x, viewport.y),
    screenToScene(t, viewport.x + viewport.width, viewport.y),
    screenToScene(t, viewport.x, viewport.y + viewport.height),
    screenToScene(t, viewport.x + viewport.width, viewport.y + viewport.height),
  ];
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function applyToCtx(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  t: SceneTransform,
): void {
  ctx.translate(t.centerX + t.panX, t.centerY + t.panY);
  ctx.rotate(t.rotation);
  ctx.scale(t.zoom, t.zoom);
  ctx.translate(-t.centerX, -t.centerY);
}
