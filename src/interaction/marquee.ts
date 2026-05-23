import type { Polygon } from '../geometry/polygon';
import type { AffineTransform } from '../geometry/transform';
import { applyToPolygon } from '../geometry/transform';
import { boundingBox } from '../geometry/polygon';
import { clipPolygon, isEmptyPolygon } from '../geometry/clip';
import type { ClipRect } from '../geometry/clip';

export interface SelectableTile {
  readonly polygon: Polygon;
  readonly transform: AffineTransform;
}

export interface MarqueeState {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
}

export function startSelection(x: number, y: number): MarqueeState {
  return { startX: x, startY: y, endX: x, endY: y };
}

export function updateSelection(state: MarqueeState, x: number, y: number): MarqueeState {
  return { ...state, endX: x, endY: y };
}

export function endSelection(state: MarqueeState): ClipRect {
  return {
    minX: Math.min(state.startX, state.endX),
    minY: Math.min(state.startY, state.endY),
    maxX: Math.max(state.startX, state.endX),
    maxY: Math.max(state.startY, state.endY),
  };
}

function transformedPolygon(tile: SelectableTile): Polygon {
  return applyToPolygon(tile.transform, tile.polygon);
}

function isFullyInside(poly: Polygon, rect: ClipRect): boolean {
  const bb = boundingBox(poly);
  return (
    bb.min.x >= rect.minX - 1e-10 &&
    bb.min.y >= rect.minY - 1e-10 &&
    bb.max.x <= rect.maxX + 1e-10 &&
    bb.max.y <= rect.maxY + 1e-10
  );
}

export function getTilesFullyInside<T extends SelectableTile>(
  tiles: readonly T[],
  rect: ClipRect,
): T[] {
  return tiles.filter((tile) => {
    const poly = transformedPolygon(tile);
    return isFullyInside(poly, rect);
  });
}

export function getTilesPartiallyInside<T extends SelectableTile>(
  tiles: readonly T[],
  rect: ClipRect,
): T[] {
  return tiles.filter((tile) => {
    const poly = transformedPolygon(tile);
    const bb = boundingBox(poly);

    if (bb.max.x < rect.minX || bb.min.x > rect.maxX ||
        bb.max.y < rect.minY || bb.min.y > rect.maxY) {
      return false;
    }

    const clipped = clipPolygon(poly, rect);
    return !isEmptyPolygon(clipped);
  });
}
