import type { Point } from '../geometry/point';
import { distance } from '../geometry/point';
import type { SceneTransform } from '../render/renderer';
import { screenToScene, sceneToScreen } from '../render/renderer';
import type { DraggablePiece } from './drag-handler';

export interface RotateState {
  readonly isRotating: boolean;
  readonly pieceId: string | null;
  readonly startAngle: number;
  readonly currentAngle: number;
}

/** Snap increment in radians: 30° = π/6 (matches Hat 6-fold & Spectre 12-fold symmetry). */
const SNAP_INCREMENT = Math.PI / 6;
const HANDLE_RADIUS_SCENE = 12;

export class RotateHandler {
  private _isRotating = false;
  private _pieceId: string | null = null;
  private _centroid: Point | null = null;
  private _startAngle = 0;
  private _baseRotation = 0;
  private _currentAngle = 0;

  get state(): RotateState {
    return {
      isRotating: this._isRotating,
      pieceId: this._pieceId,
      startAngle: this._startAngle,
      currentAngle: this._currentAngle,
    };
  }

  getRotationAngle(): number {
    return this._currentAngle;
  }

  /**
   * Whether the pointer (in screen coords) is near the rotation handle
   * (centroid of the piece in scene coords, projected to screen).
   */
  isClickOnHandle(
    screenX: number,
    screenY: number,
    piece: DraggablePiece,
    sceneTransform: SceneTransform,
  ): boolean {
    const c = this.getCentroid(piece);
    const screenCentroid = sceneToScreen(sceneTransform, c.x, c.y);
    const handleRadiusScreen = HANDLE_RADIUS_SCENE * sceneTransform.zoom;
    return distance(
      { x: screenX, y: screenY },
      screenCentroid,
    ) <= handleRadiusScreen;
  }

  /** Get scene-space centroid for a piece. */
  getCentroid(piece: DraggablePiece): Point {
    const verts = piece.polygon.vertices;
    const n = verts.length;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += verts[i].x;
      cy += verts[i].y;
    }
    return {
      x: cx / n + piece.position.x,
      y: cy / n + piece.position.y,
    };
  }

  /**
   * Draw the rotation handle (small circle at centroid).
   * Call this during rendering when a piece is selected.
   */
  showRotationHandle(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    piece: DraggablePiece,
    sceneTransform: SceneTransform,
  ): void {
    const c = this.getCentroid(piece);
    const screen = sceneToScreen(sceneTransform, c.x, c.y);
    const r = HANDLE_RADIUS_SCENE * sceneTransform.zoom;

    ctx.save();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Begin rotation mode. Returns true if rotation started.
   * `baseRotation` is the piece's current cumulative rotation.
   */
  onPointerDown(
    screenX: number,
    screenY: number,
    piece: DraggablePiece,
    sceneTransform: SceneTransform,
  ): boolean {
    if (this._isRotating) return false;

    if (!this.isClickOnHandle(screenX, screenY, piece, sceneTransform)) {
      return false;
    }

    const c = this.getCentroid(piece);
    const scenePt = screenToScene(sceneTransform, screenX, screenY);

    this._isRotating = true;
    this._pieceId = piece.id;
    this._centroid = c;
    this._startAngle = Math.atan2(scenePt.y - c.y, scenePt.x - c.x);
    this._baseRotation = piece.rotation;
    this._currentAngle = piece.rotation;

    return true;
  }

  /**
   * Update rotation during drag. Returns the new absolute rotation
   * angle (radians) for the piece, or null if not rotating.
   */
  onPointerMove(
    screenX: number,
    screenY: number,
    sceneTransform: SceneTransform,
  ): number | null {
    if (!this._isRotating || this._centroid === null || this._pieceId === null) {
      return null;
    }

    const scenePt = screenToScene(sceneTransform, screenX, screenY);
    const angle = Math.atan2(scenePt.y - this._centroid.y, scenePt.x - this._centroid.x);
    const delta = angle - this._startAngle;

    this._currentAngle = this._baseRotation + delta;
    return this._currentAngle;
  }

  /**
   * End rotation. Snaps to nearest 30° increment.
   * Returns the snapped angle, or null if not rotating.
   */
  onPointerUp(): number | null {
    if (!this._isRotating) return null;

    const snapped = snapToIncrement(this._currentAngle);
    this._currentAngle = snapped;

    this._isRotating = false;
    this._pieceId = null;
    this._centroid = null;
    this._startAngle = 0;
    this._baseRotation = 0;

    return snapped;
  }

  /** Cancel rotation without snapping. */
  cancel(): void {
    this._isRotating = false;
    this._pieceId = null;
    this._centroid = null;
    this._startAngle = 0;
    this._baseRotation = 0;
    this._currentAngle = 0;
  }
}

/**
 * Snap angle to nearest 30° increment (π/6 radians).
 * Math formula: round(angle / increment) * increment.
 */
function snapToIncrement(angle: number): number {
  return Math.round(angle / SNAP_INCREMENT) * SNAP_INCREMENT;
}
