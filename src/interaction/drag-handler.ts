import type { Point } from '../geometry/point';
import { subtract } from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import { centroid } from '../geometry/polygon';
import type { SceneTransform } from '../render/renderer';
import { screenToScene } from '../render/renderer';
import type { TileCacheEntry } from '../render/tile-renderer';

export interface DragState {
  readonly isDragging: boolean;
  readonly pieceId: string | null;
  readonly anchorOffset: Point | null;
}

export interface DraggablePiece {
  readonly id: string;
  readonly polygon: Polygon;
  readonly cacheEntry: TileCacheEntry;
  readonly position: Point;
  readonly rotation: number;
}

export class DragHandler {
  private _grabbedPieceId: string | null = null;
  private _anchorOffset: Point | null = null;

  get state(): DragState {
    return {
      isDragging: this._grabbedPieceId !== null,
      pieceId: this._grabbedPieceId,
      anchorOffset: this._anchorOffset,
    };
  }

  getGrabbedPiece(): string | null {
    return this._grabbedPieceId;
  }

  /**
   * Hit-test: returns topmost piece id under screen coords, or null.
   * Two-pass: bounding-box fast reject → Path2D.isPointInPath precise test.
   * Pieces tested in reverse order (last = topmost in render).
   */
  hitTest(
    pieces: readonly DraggablePiece[],
    sceneTransform: SceneTransform,
    screenX: number,
    screenY: number,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ): string | null {
    const scenePt = screenToScene(sceneTransform, screenX, screenY);

    for (let i = pieces.length - 1; i >= 0; i--) {
      const piece = pieces[i];
      const bbox = piece.cacheEntry.bbox;

      // Bounding-box test in world space (bbox offset by piece position)
      const worldMinX = bbox.min.x + piece.position.x;
      const worldMinY = bbox.min.y + piece.position.y;
      const worldMaxX = bbox.max.x + piece.position.x;
      const worldMaxY = bbox.max.y + piece.position.y;

      if (
        scenePt.x < worldMinX ||
        scenePt.x > worldMaxX ||
        scenePt.y < worldMinY ||
        scenePt.y > worldMaxY
      ) {
        continue;
      }

      // Transform test point into piece-local space (undo position + rotation)
      const dx = scenePt.x - piece.position.x;
      const dy = scenePt.y - piece.position.y;
      let localX: number;
      let localY: number;

      if (piece.rotation !== 0) {
        const c = Math.cos(-piece.rotation);
        const s = Math.sin(-piece.rotation);
        localX = dx * c - dy * s;
        localY = dx * s + dy * c;
      } else {
        localX = dx;
        localY = dy;
      }

      if (ctx.isPointInPath(piece.cacheEntry.path, localX, localY)) {
        return piece.id;
      }
    }

    return null;
  }

  /**
   * Begin drag: hit-test, capture pointer, compute anchor offset.
   * Returns grabbed piece id or null.
   */
  onPointerDown(
    event: PointerEvent,
    pieces: readonly DraggablePiece[],
    sceneTransform: SceneTransform,
    element: HTMLElement,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ): string | null {
    if (this._grabbedPieceId !== null) return null;

    const hitId = this.hitTest(pieces, sceneTransform, event.clientX, event.clientY, ctx);
    if (hitId === null) return null;

    const piece = pieces.find((p) => p.id === hitId);
    if (piece === undefined) return null;

    const scenePt = screenToScene(sceneTransform, event.clientX, event.clientY);
    this._anchorOffset = subtract(scenePt, piece.position);
    this._grabbedPieceId = hitId;

    element.setPointerCapture(event.pointerId);

    return hitId;
  }

  /** Move dragged piece. Returns new scene-space position or null. */
  onPointerMove(
    event: PointerEvent,
    sceneTransform: SceneTransform,
  ): Point | null {
    if (this._grabbedPieceId === null || this._anchorOffset === null) return null;

    const scenePt = screenToScene(sceneTransform, event.clientX, event.clientY);
    return {
      x: scenePt.x - this._anchorOffset.x,
      y: scenePt.y - this._anchorOffset.y,
    };
  }

  /**
   * End drag. Resets internal state. Caller should use the last
   * onPointerMove result as the final position for snap checking.
   */
  onPointerUp(_event: PointerEvent): void {
    this._grabbedPieceId = null;
    this._anchorOffset = null;
  }

  /** Release and return grabbed piece info, or null if not dragging. */
  release(): { pieceId: string; anchorOffset: Point } | null {
    if (this._grabbedPieceId === null || this._anchorOffset === null) return null;

    const result = { pieceId: this._grabbedPieceId, anchorOffset: this._anchorOffset };
    this._grabbedPieceId = null;
    this._anchorOffset = null;
    return result;
  }

  /**
   * Reorder pieces array so `pieceId` is last (top of render order).
   * Returns new array without mutating input.
   */
  static bringToTop<T extends { id: string }>(pieces: readonly T[], pieceId: string): T[] {
    const idx = pieces.findIndex((p) => p.id === pieceId);
    if (idx === -1 || idx === pieces.length - 1) return [...pieces];
    const result = [...pieces];
    const [removed] = result.splice(idx, 1);
    result.push(removed);
    return result;
  }

  /** World-space centroid of a piece (polygon centroid + position). */
  static worldCentroid(piece: DraggablePiece): Point {
    const c = centroid(piece.polygon);
    return { x: c.x + piece.position.x, y: c.y + piece.position.y };
  }
}
