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

type TabName = 'freehand' | 'bezier' | 'preset';

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

const PRESET_LINE: EdgeCurveData = {
  offsets: [
    { t: 0, offset: 0 },
    { t: 0.5, offset: 0 },
  ],
};

export const USE_ORIGINAL_CURVE: EdgeCurveData = { offsets: [] };

const PRESET_SPECTRE_PREVIEW: EdgeCurveData = {
  offsets: [
    { t: 0, offset: 0 },
    { t: 0.08, offset: 0.2 },
    { t: 0.17, offset: 0.4 },
    { t: 0.25, offset: 0.5 },
    { t: 0.33, offset: 0.4 },
    { t: 0.42, offset: 0.2 },
    { t: 0.5, offset: 0 },
  ],
};

const LS_TAB = 'spectre-curve-tab';
const LS_FREEHAND = 'spectre-curve-freehand';
const LS_BEZIER = 'spectre-curve-bezier';
const LS_PRESET = 'spectre-curve-preset';

function loadTab(): TabName {
  try {
    const v = localStorage.getItem(LS_TAB);
    if (v === 'freehand' || v === 'bezier' || v === 'preset') return v;
  } catch { /* ignore */ }
  return 'preset';
}

function saveTab(tab: TabName): void {
  try { localStorage.setItem(LS_TAB, tab); } catch { /* ignore */ }
}

function loadFreehandData(): EdgeCurveData | null {
  try {
    const s = localStorage.getItem(LS_FREEHAND);
    if (s) return JSON.parse(s) as EdgeCurveData;
  } catch { /* ignore */ }
  return null;
}

function saveFreehandData(data: EdgeCurveData): void {
  try { localStorage.setItem(LS_FREEHAND, JSON.stringify(data)); } catch { /* ignore */ }
}

function loadBezierData(): EdgeCurveData | null {
  try {
    const s = localStorage.getItem(LS_BEZIER);
    if (s) return JSON.parse(s) as EdgeCurveData;
  } catch { /* ignore */ }
  return null;
}

function saveBezierData(data: EdgeCurveData): void {
  try { localStorage.setItem(LS_BEZIER, JSON.stringify(data)); } catch { /* ignore */ }
}

function loadPresetSelection(): 'line' | 'spectre' {
  try {
    const v = localStorage.getItem(LS_PRESET);
    if (v === 'line' || v === 'spectre') return v;
  } catch { /* ignore */ }
  return 'spectre';
}

function savePresetSelection(sel: 'line' | 'spectre'): void {
  try { localStorage.setItem(LS_PRESET, sel); } catch { /* ignore */ }
}

function cloneCurve(d: EdgeCurveData): EdgeCurveData {
  return { offsets: d.offsets.map(o => ({ t: o.t, offset: o.offset })) };
}

function isValidCurve(d: unknown): d is EdgeCurveData {
  if (!d || typeof d !== 'object') return false;
  const obj = d as Record<string, unknown>;
  if (!Array.isArray(obj['offsets'])) return false;
  const arr = obj['offsets'] as unknown[];
  if (arr.length < 2) return false;
  for (const item of arr) {
    if (!item || typeof item !== 'object') return false;
    const it = item as Record<string, unknown>;
    if (typeof it['t'] !== 'number' || typeof it['offset'] !== 'number') return false;
  }
  return true;
}

export class CurveEditor {
  private overlay: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tabBtns: HTMLButtonElement[] = [];
  private presetPanel: HTMLDivElement | null = null;

  private activeTab: TabName = 'preset';

  private freehandCurveData: EdgeCurveData = PRESET_LINE;
  private bezierCurveData: EdgeCurveData = PRESET_LINE;
  private presetSelection: 'line' | 'spectre' = 'spectre';

  private resolvePromise: ((result: EdgeCurveData | null) => void) | null = null;

  private isDrawing = false;
  private rawPoints: Point[] = [];

  private dragIndex = -1;
  private ghostPointT: number | null = null;
  private selectedPointIndex: number | null = null;
  private isDraggingNewPoint = false;
  private dragStartPos: Point | null = null;

  private abortController: AbortController | null = null;

  constructor(_container?: HTMLElement) {
    void _container;
  }

  open(existingCurve?: EdgeCurveData): Promise<EdgeCurveData | null> {
    ensureCssLoaded();

    this.activeTab = loadTab();

    const fhLoaded = loadFreehandData();
    this.freehandCurveData = (fhLoaded && isValidCurve(fhLoaded)) ? cloneCurve(fhLoaded) : this.makeDefaultCurve();

    const bzLoaded = loadBezierData();
    this.bezierCurveData = (bzLoaded && isValidCurve(bzLoaded)) ? cloneCurve(bzLoaded) : this.makeDefaultCurve();

    this.presetSelection = loadPresetSelection();

    if (existingCurve) {
      const clamped = this.clampCurve(existingCurve);
      if (!fhLoaded) {
        this.freehandCurveData = clamped;
      }
      if (!bzLoaded) {
        this.bezierCurveData = clamped;
      }
    }

    this.isDrawing = false;
    this.rawPoints = [];
    this.dragIndex = -1;
    this.ghostPointT = null;
    this.selectedPointIndex = null;
    this.isDraggingNewPoint = false;
    this.dragStartPos = null;

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
    this.tabBtns = [];
    this.presetPanel = null;
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

  private clampCurve(curve: EdgeCurveData): EdgeCurveData {
    const clamped = curve.offsets
      .filter(o => o.t <= 0.5 + 0.01)
      .map(o => ({ t: Math.min(0.5, Math.max(0, o.t)), offset: o.offset }));
    if (clamped.length < 2) {
      clamped.push({ t: 0, offset: 0 }, { t: 0.5, offset: 0 });
    }
    if (clamped[0].t > 0.001) clamped.unshift({ t: 0, offset: 0 });
    return { offsets: clamped };
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

    const tabBar = document.createElement('div');
    tabBar.className = 'curve-editor-tabs';

    const tabs: Array<{ name: TabName; label: string }> = [
      { name: 'freehand', label: 'Freehand' },
      { name: 'bezier', label: 'Bezier' },
      { name: 'preset', label: 'Preset' },
    ];

    this.tabBtns = [];
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.className = 'curve-editor-tab-btn' + (tab.name === this.activeTab ? ' active' : '');
      btn.textContent = tab.label;
      btn.type = 'button';
      this.tabBtns.push(btn);
      tabBar.appendChild(btn);
    }

    this.presetPanel = document.createElement('div');
    this.presetPanel.className = 'curve-editor-preset-panel' + (this.activeTab === 'preset' ? ' active' : '');

    const presetOptions: Array<{ value: 'line' | 'spectre'; label: string; desc: string }> = [
      { value: 'line', label: 'Straight', desc: 'Flat edges, no curve' },
      { value: 'spectre', label: 'Spectre Default', desc: 'Classic Spectre interlocking curve' },
    ];

    for (const opt of presetOptions) {
      const optDiv = document.createElement('div');
      optDiv.className = 'curve-editor-preset-option';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'curve-preset';
      radio.value = opt.value;
      radio.checked = this.presetSelection === opt.value;

      const label = document.createElement('label');
      label.textContent = `${opt.label} — ${opt.desc}`;

      const radioRef = radio;
      optDiv.addEventListener('click', () => {
        radioRef.checked = true;
        this.presetSelection = opt.value;
        savePresetSelection(opt.value);
        this.render();
      });

      optDiv.appendChild(radio);
      optDiv.appendChild(label);
      this.presetPanel.appendChild(optDiv);
    }

    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'curve-editor-canvas-wrapper';

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.updateCanvasClass();
    this.ctx = this.canvas.getContext('2d');

    canvasWrapper.appendChild(this.canvas);

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
    modal.appendChild(tabBar);
    modal.appendChild(this.presetPanel);
    modal.appendChild(canvasWrapper);
    modal.appendChild(actions);
    this.overlay.appendChild(modal);

    document.body.appendChild(this.overlay);

    this.attachListeners(closeBtn, resetBtn, cancelBtn, saveBtn);
  }

  private updateCanvasClass(): void {
    if (!this.canvas) return;
    this.canvas.className = 'curve-editor-canvas';
    if (this.activeTab === 'preset') {
      this.canvas.classList.add('mode-preset');
    } else if (this.activeTab === 'freehand') {
      this.canvas.classList.add('mode-freehand');
    } else {
      this.canvas.classList.add('mode-bezier');
    }
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

    const tabNames: TabName[] = ['freehand', 'bezier', 'preset'];
    for (let i = 0; i < this.tabBtns.length; i++) {
      const tabName = tabNames[i];
      this.tabBtns[i].addEventListener('click', () => this.switchTab(tabName), { signal });
    }

    canvas.addEventListener('mousedown', e => this.onMouseDown(e), { signal });
    window.addEventListener('mousemove', e => this.onMouseMove(e), { signal });
    window.addEventListener('mouseup', () => this.onMouseUp(), { signal });
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

  private switchTab(newTab: TabName): void {
    if (this.activeTab === newTab) return;

    if (this.activeTab === 'freehand' && this.isDrawing) {
      this.isDrawing = false;
      if (this.rawPoints.length >= 2) {
        this.freehandCurveData.offsets = freehandToOffsets(this.rawPoints);
        saveFreehandData(this.freehandCurveData);
      }
      this.rawPoints = [];
    }

    if (this.activeTab === 'bezier') {
      saveBezierData(this.bezierCurveData);
    }

    this.activeTab = newTab;
    saveTab(newTab);

    const tabNames: TabName[] = ['freehand', 'bezier', 'preset'];
    for (let i = 0; i < this.tabBtns.length; i++) {
      this.tabBtns[i].classList.toggle('active', tabNames[i] === newTab);
    }

    if (this.presetPanel) {
      this.presetPanel.classList.toggle('active', newTab === 'preset');
    }

    this.updateCanvasClass();

    this.dragIndex = -1;
    this.ghostPointT = null;
    this.selectedPointIndex = null;
    this.isDraggingNewPoint = false;
    this.dragStartPos = null;

    this.render();
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.canvas) return;
    const pos = getCanvasCoords(this.canvas, e);

    if (this.activeTab === 'freehand') {
      if (e.button !== 0) return;
      if (pos.x > MID_X) return;
      this.isDrawing = true;
      this.rawPoints = [pos];
      this.render();
    } else if (this.activeTab === 'bezier') {
      if (e.button !== 0) return;
      if (pos.x > MID_X) return;

      if (this.selectedPointIndex !== null) {
        const offsets = this.bezierCurveData.offsets;
        const idx = this.selectedPointIndex;
        const isEndpoint = idx === 0 || idx === offsets.length - 1;
        if (!isEndpoint) {
          const cp = paramToCanvas(offsets[idx].t, offsets[idx].offset);
          const btnX = cp.x;
          const btnY = cp.y + 18;
          const dx = pos.x - btnX;
          const dy = pos.y - btnY;
          if (dx * dx + dy * dy <= 12 * 12) {
            offsets.splice(idx, 1);
            this.selectedPointIndex = null;
            saveBezierData(this.bezierCurveData);
            this.render();
            return;
          }
        }
      }

      const idx = findNearestOffsetIndex(this.bezierCurveData.offsets, pos.x, pos.y);
      if (idx >= 0) {
        this.dragIndex = idx;
        this.dragStartPos = { x: pos.x, y: pos.y };
        this.canvas.style.cursor = 'grabbing';
      } else if (this.ghostPointT !== null) {
        const t = this.ghostPointT;
        const offset = interpolateOffset(this.bezierCurveData.offsets, t);
        const offsets = this.bezierCurveData.offsets;

        let insertIdx = offsets.findIndex(o => o.t > t);
        if (insertIdx < 0) insertIdx = offsets.length;

        offsets.splice(insertIdx, 0, { t, offset });
        this.dragIndex = insertIdx;
        this.isDraggingNewPoint = true;
        this.dragStartPos = { x: pos.x, y: pos.y };
        this.ghostPointT = null;
        this.canvas.style.cursor = 'grabbing';
        saveBezierData(this.bezierCurveData);
        this.render();
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.canvas) return;
    const pos = getCanvasCoords(this.canvas, e);

    if (this.activeTab === 'freehand') {
      if (this.isDrawing) {
        if (pos.x <= MID_X + 2) {
          this.rawPoints.push(pos);
        }
        this.render();
      }
    } else if (this.activeTab === 'bezier') {
      if (this.dragIndex >= 0) {
        const pp = canvasToParam(pos.x, pos.y);
        const offsets = this.bezierCurveData.offsets;
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
        this.selectedPointIndex = null;
        saveBezierData(this.bezierCurveData);
        this.render();
      } else {
        const idx = findNearestOffsetIndex(this.bezierCurveData.offsets, pos.x, pos.y);
        let needsRender = false;
        if (idx >= 0) {
          this.canvas.style.cursor = 'default';
          if (this.ghostPointT !== null) {
            this.ghostPointT = null;
            needsRender = true;
          }
        } else {
          const t = findNearestCurveT(this.bezierCurveData.offsets, pos.x, pos.y);
          if (t >= 0 && t <= 0.5) {
            this.canvas.style.cursor = 'default';
            if (this.ghostPointT !== t) {
              this.ghostPointT = t;
              needsRender = true;
            }
          } else {
            this.canvas.style.cursor = 'default';
            if (this.ghostPointT !== null) {
              this.ghostPointT = null;
              needsRender = true;
            }
            if (this.selectedPointIndex !== null) {
              this.selectedPointIndex = null;
              needsRender = true;
            }
          }
        }
        if (needsRender) this.render();
      }
    }
  }

  private onMouseUp(): void {
    if (this.activeTab === 'freehand') {
      if (this.isDrawing) {
        this.isDrawing = false;
        if (this.rawPoints.length >= 2) {
          this.freehandCurveData.offsets = freehandToOffsets(this.rawPoints);
          saveFreehandData(this.freehandCurveData);
        }
        this.rawPoints = [];
        this.render();
      }
    } else if (this.activeTab === 'bezier') {
      if (this.dragIndex >= 0) {
        const offsets = this.bezierCurveData.offsets;
        const idx = this.dragIndex;
        if (this.dragStartPos && idx >= 0 && idx < offsets.length) {
          const cp = paramToCanvas(offsets[idx].t, offsets[idx].offset);
          const dx = cp.x - this.dragStartPos.x;
          const dy = cp.y - this.dragStartPos.y;
          if (Math.sqrt(dx * dx + dy * dy) < 3) {
            this.selectedPointIndex = idx;
          }
        }

        this.dragIndex = -1;
        this.isDraggingNewPoint = false;
        this.dragStartPos = null;
        this.canvas!.style.cursor = 'default';
        saveBezierData(this.bezierCurveData);
        this.render();
      }
    }
  }

  private render(): void {
    this.renderMainCanvas();
  }

  private renderMainCanvas(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.fillStyle = 'rgba(74, 60, 40, 0.04)';
    ctx.fillRect(MID_X, 0, END_X - MID_X, CANVAS_H);
    ctx.restore();

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
    ctx.fillText('\u22120.5', START_X - 4, limitY_down + 3);
    ctx.restore();

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

    if (this.activeTab === 'preset' && this.presetSelection === 'spectre') {
      const p0 = paramToCanvas(0, 0);
      const p1 = paramToCanvas(1 / 3, 0.6);
      const p2 = paramToCanvas(2 / 3, 0.6);
      const p3 = paramToCanvas(1, 0);

      ctx.save();
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const userOffsets = this.getActiveOffsets();

    if (this.activeTab === 'freehand' && this.isDrawing && this.rawPoints.length >= 2) {
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

    const mirrored: BezierOffset[] = [];
    for (let i = userOffsets.length - 1; i >= 0; i--) {
      const bo = userOffsets[i];
      if (bo.t < 0.5 - 0.001) {
        mirrored.push({ t: 1 - bo.t, offset: -bo.offset });
      }
    }

    if (userOffsets.length >= 2) {
      const fullEdge = [...userOffsets, ...mirrored];
      fullEdge.sort((a, b) => a.t - b.t);

      ctx.save();
      ctx.strokeStyle = 'rgba(139, 105, 20, 0.35)';
      ctx.lineWidth = 2.5;
      drawCurvePath(ctx, fullEdge);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = '#8b6914';
      ctx.lineWidth = 2.5;
      drawCurvePath(ctx, userOffsets);
      ctx.stroke();
      ctx.restore();
    }

    if (this.activeTab === 'bezier') {
      for (let i = 0; i < userOffsets.length; i++) {
        const cp = paramToCanvas(userOffsets[i].t, userOffsets[i].offset);
        const isEndpoint = i === 0 || i === userOffsets.length - 1;
        const isSelected = this.selectedPointIndex === i;

        ctx.save();
        if (isSelected) {
          ctx.fillStyle = '#e74c3c';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
        } else {
          ctx.fillStyle = isEndpoint ? '#8b6914' : '#a07b1a';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
        }

        ctx.beginPath();
        ctx.arc(cp.x, cp.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

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

      if (this.ghostPointT !== null) {
        const ghostOffset = interpolateOffset(userOffsets, this.ghostPointT);
        const cp = paramToCanvas(this.ghostPointT, ghostOffset);
        ctx.save();
        ctx.strokeStyle = 'rgba(139, 105, 20, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      if (this.selectedPointIndex !== null) {
        const idx = this.selectedPointIndex;
        const isEndpoint = idx === 0 || idx === userOffsets.length - 1;
        if (!isEndpoint) {
          const cp = paramToCanvas(userOffsets[idx].t, userOffsets[idx].offset);
          const btnX = cp.x;
          const btnY = cp.y + 18;
          const btnR = 8;

          ctx.save();
          ctx.fillStyle = '#c0392b';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(btnX, btnY, btnR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          const xSize = 3.5;
          ctx.beginPath();
          ctx.moveTo(btnX - xSize, btnY - xSize);
          ctx.lineTo(btnX + xSize, btnY + xSize);
          ctx.moveTo(btnX + xSize, btnY - xSize);
          ctx.lineTo(btnX - xSize, btnY + xSize);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  private getActiveOffsets(): BezierOffset[] {
    if (this.activeTab === 'freehand') {
      return this.freehandCurveData.offsets;
    } else if (this.activeTab === 'bezier') {
      return this.bezierCurveData.offsets;
    } else {
      return this.presetSelection === 'line' ? PRESET_LINE.offsets : PRESET_SPECTRE_PREVIEW.offsets;
    }
  }

  private save(): void {
    if (this.activeTab === 'freehand') {
      saveFreehandData(this.freehandCurveData);
    } else if (this.activeTab === 'bezier') {
      saveBezierData(this.bezierCurveData);
    }

    let result: EdgeCurveData;
    if (this.activeTab === 'preset' && this.presetSelection === 'spectre') {
      result = USE_ORIGINAL_CURVE;
    } else {
      result = {
        offsets: this.getActiveOffsets().map(o => ({ t: o.t, offset: o.offset })),
      };
    }
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
    if (this.activeTab === 'freehand') {
      this.freehandCurveData = this.makeDefaultCurve();
      saveFreehandData(this.freehandCurveData);
    } else if (this.activeTab === 'bezier') {
      this.bezierCurveData = this.makeDefaultCurve();
      saveBezierData(this.bezierCurveData);
    }
    if (this.activeTab === 'preset') {
      this.presetSelection = 'spectre';
      savePresetSelection('spectre');
      if (this.presetPanel) {
        const radios = this.presetPanel.querySelectorAll('input[type="radio"]');
        radios.forEach(r => {
          const el = r as HTMLInputElement;
          el.checked = el.value === 'spectre';
        });
      }
    }

    this.rawPoints = [];
    this.isDrawing = false;
    this.dragIndex = -1;
    this.ghostPointT = null;
    this.selectedPointIndex = null;
    this.isDraggingNewPoint = false;
    this.dragStartPos = null;
    this.render();
  }
}
