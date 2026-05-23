import type { Point } from '../geometry/point';

export interface BezierOffset {
  t: number;
  offset: number;
}

export interface EdgeCurveData {
  offsets: BezierOffset[];
}

const CANVAS_W = 600;
const CANVAS_H = 350;
const PREVIEW_W = 200;
const PREVIEW_H = 180;
const MAX_OFFSET = 0.5;
const START_X = CANVAS_W * 0.05;
const MID_X = CANVAS_W * 0.50;
const END_X = CANVAS_W * 0.95;
const BASELINE_Y = CANVAS_H * 0.5;
const HALF_EDGE_LEN = MID_X - START_X;
const NUM_RESAMPLE = 20;
const POINT_RADIUS = 6;
const HIT_RADIUS = 14;
const SMOOTH_ITERATIONS = 3;

type DrawingMode = 'freehand' | 'bezier';

interface ParamPoint {
  t: number;
  offset: number;
}

function paramToCanvas(t: number, offset: number): Point {
  // Map t ∈ [0, 0.5] → [START_X, MID_X] (editable left half)
  // Map t ∈ [0.5, 1] → [MID_X, END_X] (mirror preview right half)
  const x = t <= 0.5
    ? START_X + (t / 0.5) * HALF_EDGE_LEN
    : MID_X + ((t - 0.5) / 0.5) * (END_X - MID_X);
  return {
    x,
    y: BASELINE_Y - offset * HALF_EDGE_LEN,
  };
}

function canvasToParam(x: number, y: number): ParamPoint {
  return {
    t: Math.max(0, Math.min(0.5, (x - START_X) / HALF_EDGE_LEN)),
    offset: Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, (BASELINE_Y - y) / HALF_EDGE_LEN)),
  };
}

function getCanvasCoords(canvas: HTMLCanvasElement, e: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function interpolateOffset(pts: ParamPoint[], targetT: number): number {
  if (pts.length === 0) return 0;
  if (targetT <= pts[0].t) return pts[0].offset;
  if (targetT >= pts[pts.length - 1].t) return pts[pts.length - 1].offset;

  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].t <= targetT && pts[i + 1].t >= targetT) {
      const denom = pts[i + 1].t - pts[i].t;
      if (denom < 1e-12) return (pts[i].offset + pts[i + 1].offset) / 2;
      const frac = (targetT - pts[i].t) / denom;
      return pts[i].offset + frac * (pts[i + 1].offset - pts[i].offset);
    }
  }
  return 0;
}

function smoothOffsets(offsets: ParamPoint[]): ParamPoint[] {
  let result = offsets.map(o => ({ ...o }));
  for (let iter = 0; iter < SMOOTH_ITERATIONS; iter++) {
    result = result.map((o, i) => {
      if (i === 0 || i === result.length - 1) return { ...o };
      return {
        t: o.t,
        offset: (result[i - 1].offset + o.offset * 2 + result[i + 1].offset) / 4,
      };
    });
  }
  return result;
}

function freehandToOffsets(rawPoints: Point[]): BezierOffset[] {
  if (rawPoints.length < 2) {
    return [
      { t: 0, offset: 0 },
      { t: 0.5, offset: 0 },
    ];
  }

  const params: ParamPoint[] = [];
  for (const p of rawPoints) {
    const pp = canvasToParam(p.x, p.y);
    if (pp.t >= -0.05 && pp.t <= 0.52) {
      pp.t = Math.max(0, Math.min(0.5, pp.t));
      params.push(pp);
    }
  }

  if (params.length < 2) {
    return [
      { t: 0, offset: 0 },
      { t: 0.5, offset: 0 },
    ];
  }

  params.sort((a, b) => a.t - b.t);

  const merged: ParamPoint[] = [];
  const EPS = 0.002;
  for (const p of params) {
    if (merged.length > 0 && Math.abs(merged[merged.length - 1].t - p.t) < EPS) {
      merged[merged.length - 1].offset =
        (merged[merged.length - 1].offset + p.offset) / 2;
    } else {
      merged.push({ t: p.t, offset: p.offset });
    }
  }

  if (merged.length > 0 && merged[0].t > 0.01) merged.unshift({ t: 0, offset: 0 });
  if (merged.length > 0 && merged[merged.length - 1].t < 0.49) merged.push({ t: 0.5, offset: 0 });

  const resampled: ParamPoint[] = [];
  for (let i = 0; i <= NUM_RESAMPLE; i++) {
    const targetT = (i / NUM_RESAMPLE) * 0.5;
    resampled.push({ t: targetT, offset: interpolateOffset(merged, targetT) });
  }

  const smoothed = smoothOffsets(resampled);
  for (const p of smoothed) {
    p.offset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, p.offset));
  }
  smoothed[0] = { t: 0, offset: 0 };
  smoothed[smoothed.length - 1] = { t: 0.5, offset: 0 };
  return smoothed;
}

function drawCurvePath(
  ctx: CanvasRenderingContext2D,
  offsets: BezierOffset[],
): void {
  const points = offsets.map(o => paramToCanvas(o.t, o.offset));
  if (points.length < 2) return;

  // Clamp bezier control point Y to ±MAX_OFFSET range to prevent Catmull-Rom overshoot
  const yMin = BASELINE_Y - MAX_OFFSET * HALF_EDGE_LEN;
  const yMax = BASELINE_Y + MAX_OFFSET * HALF_EDGE_LEN;
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y));

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      clampY(p1.y + (p2.y - p0.y) / 6),
      p2.x - (p3.x - p1.x) / 6,
      clampY(p2.y - (p3.y - p1.y) / 6),
      p2.x,
      p2.y,
    );
  }
}

function findNearestOffsetIndex(
  offsets: BezierOffset[],
  canvasX: number,
  canvasY: number,
): number {
  let minDist = Infinity;
  let minIdx = -1;
  for (let i = 0; i < offsets.length; i++) {
    const cp = paramToCanvas(offsets[i].t, offsets[i].offset);
    const dx = cp.x - canvasX;
    const dy = cp.y - canvasY;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      minIdx = i;
    }
  }
  return minDist <= HIT_RADIUS * HIT_RADIUS ? minIdx : -1;
}

function findNearestCurveT(
  offsets: BezierOffset[],
  canvasX: number,
  canvasY: number,
): number {
  let bestT = -1;
  let bestDist = Infinity;

  for (let i = 0; i < offsets.length - 1; i++) {
    const steps = 20;
    for (let s = 0; s <= steps; s++) {
      const localT = s / steps;
      const t = offsets[i].t + localT * (offsets[i + 1].t - offsets[i].t);
      const off = interpolateOffset(offsets, t);
      const cp = paramToCanvas(t, off);
      const dx = cp.x - canvasX;
      const dy = cp.y - canvasY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestT = t;
      }
    }
  }

  return bestDist <= HIT_RADIUS * HIT_RADIUS * 4 ? bestT : -1;
}

function ensureCssLoaded(): void {
  if (document.querySelector('link[data-curve-editor-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute('data-curve-editor-css', '');
  link.href = new URL('../styles/curve-editor.css', import.meta.url).href;
  document.head.appendChild(link);
}

export class CurveEditor {
  private overlay: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private freehandBtn: HTMLButtonElement | null = null;
  private bezierBtn: HTMLButtonElement | null = null;

  private mode: DrawingMode = 'freehand';
  private curveData: EdgeCurveData = { offsets: [] };
  private initialData: EdgeCurveData = { offsets: [] };
  private resolvePromise: ((result: EdgeCurveData | null) => void) | null = null;

  private isDrawing = false;
  private rawPoints: Point[] = [];
  private dragIndex = -1;

  private abortController: AbortController | null = null;

  constructor(_container?: HTMLElement) {
    void _container;
  }

  open(existingCurve?: EdgeCurveData): Promise<EdgeCurveData | null> {
    ensureCssLoaded();

    if (existingCurve) {
      const clamped = existingCurve.offsets
        .filter(o => o.t <= 0.5 + 0.01)
        .map(o => ({ t: Math.min(0.5, Math.max(0, o.t)), offset: o.offset }));
      if (clamped.length < 2) {
        clamped.push({ t: 0, offset: 0 }, { t: 0.5, offset: 0 });
      }
      if (clamped[0].t > 0.001) clamped.unshift({ t: 0, offset: 0 });
      this.curveData = { offsets: clamped };
    } else {
      this.curveData = this.makeDefaultCurve();
    }
    this.initialData = { offsets: this.curveData.offsets.map(o => ({ t: o.t, offset: o.offset })) };
    this.mode = 'freehand';
    this.isDrawing = false;
    this.rawPoints = [];
    this.dragIndex = -1;

    this.buildModal();
    this.render();

    return new Promise<EdgeCurveData | null>(resolve => {
      this.resolvePromise = resolve;
    });
  }

  destroy(): void {
    this.detachListeners();
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.previewCanvas = null;
    this.previewCtx = null;
    this.freehandBtn = null;
    this.bezierBtn = null;
    this.resolvePromise = null;
  }

  private makeDefaultCurve(): EdgeCurveData {
    return {
      offsets: [
        { t: 0, offset: 0 },
        { t: 0.25, offset: 0 },
        { t: 0.5, offset: 0 },
      ],
    };
  }

  private buildModal(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'curve-editor-overlay';

    const modal = document.createElement('div');
    modal.className = 'curve-editor-modal';

    const header = document.createElement('div');
    header.className = 'curve-editor-header';

    const title = document.createElement('h3');
    title.textContent = 'Edge Curve Editor';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'curve-editor-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.type = 'button';

    header.appendChild(title);
    header.appendChild(closeBtn);

    const toolbar = document.createElement('div');
    toolbar.className = 'curve-editor-toolbar';

    this.freehandBtn = document.createElement('button');
    this.freehandBtn.className = 'curve-editor-mode-btn active';
    this.freehandBtn.textContent = 'Mode: Freehand';
    this.freehandBtn.type = 'button';

    this.bezierBtn = document.createElement('button');
    this.bezierBtn.className = 'curve-editor-mode-btn';
    this.bezierBtn.textContent = 'Mode: Bezier';
    this.bezierBtn.type = 'button';

    toolbar.appendChild(this.freehandBtn);
    toolbar.appendChild(this.bezierBtn);

    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'curve-editor-canvas-wrapper';

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.canvas.className = 'curve-editor-canvas mode-freehand';
    this.ctx = this.canvas.getContext('2d');

    canvasWrapper.appendChild(this.canvas);

    const previewSection = document.createElement('div');
    previewSection.className = 'curve-editor-preview-section';

    const previewLabel = document.createElement('span');
    previewLabel.className = 'curve-editor-preview-label';
    previewLabel.textContent = 'Preview:';

    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.width = PREVIEW_W;
    this.previewCanvas.height = PREVIEW_H;
    this.previewCanvas.className = 'curve-editor-preview-canvas';
    this.previewCtx = this.previewCanvas.getContext('2d');

    previewSection.appendChild(previewLabel);
    previewSection.appendChild(this.previewCanvas);

    const actions = document.createElement('div');
    actions.className = 'curve-editor-actions';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.textContent = 'Reset';
    resetBtn.type = 'button';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.type = 'button';

    actions.appendChild(resetBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    modal.appendChild(header);
    modal.appendChild(toolbar);
    modal.appendChild(canvasWrapper);
    modal.appendChild(previewSection);
    modal.appendChild(actions);
    this.overlay.appendChild(modal);

    document.body.appendChild(this.overlay);

    this.attachListeners(closeBtn, resetBtn, cancelBtn, saveBtn);
  }

  private attachListeners(
    closeBtn: HTMLButtonElement,
    resetBtn: HTMLButtonElement,
    cancelBtn: HTMLButtonElement,
    saveBtn: HTMLButtonElement,
  ): void {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const canvas = this.canvas!;

    closeBtn.addEventListener('click', () => this.cancel(), { signal });
    resetBtn.addEventListener('click', () => this.reset(), { signal });
    cancelBtn.addEventListener('click', () => this.cancel(), { signal });
    saveBtn.addEventListener('click', () => this.save(), { signal });

    this.freehandBtn!.addEventListener('click', () => this.switchMode('freehand'), { signal });
    this.bezierBtn!.addEventListener('click', () => this.switchMode('bezier'), { signal });

    canvas.addEventListener('mousedown', e => this.onMouseDown(e), { signal });
    window.addEventListener('mousemove', e => this.onMouseMove(e), { signal });
    window.addEventListener('mouseup', () => this.onMouseUp(), { signal });
    canvas.addEventListener('dblclick', e => this.onDblClick(e), { signal });
    canvas.addEventListener('contextmenu', e => this.onContextMenu(e), { signal });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.cancel();
    }, { signal });
  }

  private detachListeners(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private switchMode(newMode: DrawingMode): void {
    if (this.mode === newMode) return;

    if (this.mode === 'freehand' && this.isDrawing) {
      this.isDrawing = false;
      if (this.rawPoints.length >= 2) {
        this.curveData.offsets = freehandToOffsets(this.rawPoints);
      }
      this.rawPoints = [];
    }

    this.mode = newMode;

    if (this.freehandBtn && this.bezierBtn) {
      this.freehandBtn.classList.toggle('active', newMode === 'freehand');
      this.bezierBtn.classList.toggle('active', newMode === 'bezier');
    }

    if (this.canvas) {
      this.canvas.classList.toggle('mode-freehand', newMode === 'freehand');
      this.canvas.classList.toggle('mode-bezier', newMode === 'bezier');
    }

    this.render();
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.canvas) return;
    const pos = getCanvasCoords(this.canvas, e);

    if (this.mode === 'freehand') {
      if (e.button !== 0) return;
      if (pos.x > MID_X) return;
      this.isDrawing = true;
      this.rawPoints = [pos];
      this.render();
    } else {
      if (e.button !== 0) return;
      const idx = findNearestOffsetIndex(this.curveData.offsets, pos.x, pos.y);
      if (idx >= 0) {
        this.dragIndex = idx;
        if (this.canvas) this.canvas.style.cursor = 'grabbing';
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.canvas) return;
    const pos = getCanvasCoords(this.canvas, e);

    if (this.mode === 'freehand' && this.isDrawing) {
      if (pos.x <= MID_X + 2) {
        this.rawPoints.push(pos);
      }
      this.render();
    } else if (this.mode === 'bezier') {
      if (this.dragIndex >= 0) {
        const pp = canvasToParam(pos.x, pos.y);
        const offsets = this.curveData.offsets;
        const idx = this.dragIndex;

        if (idx === 0) {
          offsets[0] = { t: 0, offset: 0 };
        } else if (idx === offsets.length - 1) {
          offsets[offsets.length - 1] = { t: 0.5, offset: 0 };
        } else {
          const minT = offsets[idx - 1].t + 0.01;
          const maxT = Math.min(offsets[idx + 1].t - 0.01, 0.5);
          const clampedOffset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, pp.offset));
          offsets[idx] = {
            t: Math.max(minT, Math.min(maxT, pp.t)),
            offset: clampedOffset,
          };
        }
        this.render();
      } else {
        const idx = findNearestOffsetIndex(this.curveData.offsets, pos.x, pos.y);
        this.canvas.style.cursor = idx >= 0 ? 'grab' : 'default';
      }
    }
  }

  private onMouseUp(): void {
    if (this.mode === 'freehand' && this.isDrawing) {
      this.isDrawing = false;
      if (this.rawPoints.length >= 2) {
        this.curveData.offsets = freehandToOffsets(this.rawPoints);
      }
      this.rawPoints = [];
      this.render();
    } else if (this.mode === 'bezier' && this.dragIndex >= 0) {
      this.dragIndex = -1;
      if (this.canvas) this.canvas.style.cursor = 'default';
    }
  }

  private onDblClick(e: MouseEvent): void {
    if (this.mode !== 'bezier') return;
    if (!this.canvas) return;
    const pos = getCanvasCoords(this.canvas, e);
    if (pos.x > MID_X) return;

    const nearIdx = findNearestOffsetIndex(this.curveData.offsets, pos.x, pos.y);
    if (nearIdx >= 0) return;

    const t = findNearestCurveT(this.curveData.offsets, pos.x, pos.y);
    if (t < 0 || t > 0.5) return;

    const offset = interpolateOffset(this.curveData.offsets, t);

    let insertIdx = this.curveData.offsets.findIndex(o => o.t > t);
    if (insertIdx < 0) insertIdx = this.curveData.offsets.length;

    this.curveData.offsets.splice(insertIdx, 0, { t, offset });
    this.render();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.mode !== 'bezier') return;
    if (!this.canvas) return;
    if (this.curveData.offsets.length <= 2) return;

    const pos = getCanvasCoords(this.canvas, e);
    const idx = findNearestOffsetIndex(this.curveData.offsets, pos.x, pos.y);
    if (idx <= 0 || idx >= this.curveData.offsets.length - 1) return;

    this.curveData.offsets.splice(idx, 1);
    this.render();
  }

  private render(): void {
    this.renderMainCanvas();
    this.renderPreview();
  }

  private renderMainCanvas(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Subtle background tint for the mirror (right) half
    ctx.save();
    ctx.fillStyle = 'rgba(74, 60, 40, 0.04)';
    ctx.fillRect(MID_X, 0, END_X - MID_X, CANVAS_H);
    ctx.restore();

    // Baseline across full width
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#c4b898';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(START_X, BASELINE_Y);
    ctx.lineTo(END_X, BASELINE_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Midpoint separator
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(139, 105, 20, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(MID_X, 10);
    ctx.lineTo(MID_X, CANVAS_H - 10);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.fillStyle = 'rgba(139, 105, 20, 0.6)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('midpoint', MID_X, CANVAS_H - 2);

    // Start & end dots
    const startP = paramToCanvas(0, 0);
    ctx.fillStyle = '#8b6914';
    ctx.beginPath();
    ctx.arc(startP.x, startP.y, 5, 0, Math.PI * 2);
    ctx.fill();

    const endP = paramToCanvas(1, 0);
    ctx.fillStyle = '#8b6914';
    ctx.beginPath();
    ctx.arc(endP.x, endP.y, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#7a6c58';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Start', startP.x, startP.y + 18);
    ctx.fillText('End', endP.x, endP.y + 18);

    // ±MAX_OFFSET guide lines
    const limitY_up = BASELINE_Y - MAX_OFFSET * HALF_EDGE_LEN;
    const limitY_down = BASELINE_Y + MAX_OFFSET * HALF_EDGE_LEN;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(192, 57, 43, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(START_X, limitY_up);
    ctx.lineTo(END_X, limitY_up);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(START_X, limitY_down);
    ctx.lineTo(END_X, limitY_down);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(192, 57, 43, 0.5)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('+0.5', START_X - 4, limitY_up + 3);
    ctx.fillText('−0.5', START_X - 4, limitY_down + 3);
    ctx.restore();

    // Fixed midpoint marker at t=0.5, offset=0
    const midP = paramToCanvas(0.5, 0);
    ctx.save();
    ctx.fillStyle = '#c0392b';
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    const crossSize = 4;
    ctx.beginPath();
    ctx.moveTo(midP.x - crossSize, midP.y - crossSize);
    ctx.lineTo(midP.x + crossSize, midP.y + crossSize);
    ctx.moveTo(midP.x + crossSize, midP.y - crossSize);
    ctx.lineTo(midP.x - crossSize, midP.y + crossSize);
    ctx.stroke();
    ctx.restore();

    // Freehand raw stroke (left half only)
    if (this.mode === 'freehand' && this.isDrawing && this.rawPoints.length >= 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(139, 105, 20, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.rawPoints[0].x, this.rawPoints[0].y);
      for (let i = 1; i < this.rawPoints.length; i++) {
        ctx.lineTo(this.rawPoints[i].x, this.rawPoints[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    const userOffsets = this.curveData.offsets;

    // Build mirrored offsets for the right half
    const mirrored: BezierOffset[] = [];
    for (let i = userOffsets.length - 1; i >= 0; i--) {
      const bo = userOffsets[i];
      if (bo.t < 0.5 - 0.001) {
        mirrored.push({ t: 1 - bo.t, offset: -bo.offset });
      }
    }

    // Draw mirrored curve (muted) on right half
    if (userOffsets.length >= 2) {
      // Combine user + mirrored into full edge for drawing
      const fullEdge = [...userOffsets, ...mirrored];
      fullEdge.sort((a, b) => a.t - b.t);

      ctx.save();
      ctx.strokeStyle = 'rgba(139, 105, 20, 0.35)';
      ctx.lineWidth = 2.5;
      drawCurvePath(ctx, fullEdge);
      ctx.stroke();
      ctx.restore();

      // Draw the user's portion more boldly on top
      ctx.save();
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 2.5;
      drawCurvePath(ctx, userOffsets);
      ctx.stroke();
      ctx.restore();
    }

    // Bezier control points (user — filled, draggable)
    if (this.mode === 'bezier') {
      for (let i = 0; i < userOffsets.length; i++) {
        const cp = paramToCanvas(userOffsets[i].t, userOffsets[i].offset);
        const isEndpoint = i === 0 || i === userOffsets.length - 1;

        ctx.save();
        ctx.fillStyle = isEndpoint ? '#8b6914' : '#a07b1a';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.arc(cp.x, cp.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Mirrored control points (hollow, read-only)
      for (const m of mirrored) {
        const cp = paramToCanvas(m.t, m.offset);
        ctx.save();
        ctx.strokeStyle = 'rgba(139, 105, 20, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  private renderPreview(): void {
    const ctx = this.previewCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

    const margin = 16;
    const previewStartX = margin;
    const previewEndX = PREVIEW_W - margin;
    const previewEdgeLen = previewEndX - previewStartX;
    const halfH = PREVIEW_H / 2;

    const userOffsets = this.curveData.offsets;
    if (userOffsets.length < 2) return;

    // Build full edge: user offsets + mirrored offsets
    const fullEdge: BezierOffset[] = [...userOffsets];
    for (let i = userOffsets.length - 1; i >= 0; i--) {
      const bo = userOffsets[i];
      if (bo.t < 0.5 - 0.001) {
        fullEdge.push({ t: 1 - bo.t, offset: -bo.offset });
      }
    }
    fullEdge.sort((a, b) => a.t - b.t);

    // Complement: reversed t, negated offset
    const complementOffsets = fullEdge.map(o => ({ t: 1 - o.t, offset: -o.offset }));

    const drawCurve = (
      curveOffsets: BezierOffset[],
      baselineY: number,
      color: string,
      label: string,
    ) => {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#d4c5a9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(previewStartX, baselineY);
      ctx.lineTo(previewEndX, baselineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const points = curveOffsets.map(o => ({
        x: previewStartX + o.t * previewEdgeLen,
        y: baselineY - o.offset * previewEdgeLen,
      }));

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';

      const pLimitUp = baselineY - 0.5 * previewEdgeLen;
      const pLimitDown = baselineY + 0.5 * previewEdgeLen;
      const pClampY = (y: number) => Math.max(pLimitUp, Math.min(pLimitDown, y));

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        ctx.bezierCurveTo(
          p1.x + (p2.x - p0.x) / 6,
          pClampY(p1.y + (p2.y - p0.y) / 6),
          p2.x - (p3.x - p1.x) / 6,
          pClampY(p2.y - (p3.y - p1.y) / 6),
          p2.x,
          p2.y,
        );
      }
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(points[points.length - 1].x, points[points.length - 1].y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.font = '10px sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, previewStartX, baselineY - halfH / 2 + 2);
      ctx.restore();
    };

    drawCurve(fullEdge, halfH / 2, '#8b6914', 'Original');
    drawCurve(complementOffsets, halfH + halfH / 2, '#5a8a7a', 'Complement');
  }

  private save(): void {
    const result: EdgeCurveData = {
      offsets: this.curveData.offsets.map(o => ({ t: o.t, offset: o.offset })),
    };
    this.detachListeners();
    if (this.resolvePromise) {
      this.resolvePromise(result);
      this.resolvePromise = null;
    }
    this.destroy();
  }

  private cancel(): void {
    this.detachListeners();
    if (this.resolvePromise) {
      this.resolvePromise(null);
      this.resolvePromise = null;
    }
    this.destroy();
  }

  private reset(): void {
    this.curveData = this.makeDefaultCurve();
    this.rawPoints = [];
    this.isDrawing = false;
    this.dragIndex = -1;
    this.render();
  }
}
