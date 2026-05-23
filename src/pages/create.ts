import * as renderer from '../render/renderer';
import * as hatTiling from '../tiling/hat';
import * as spectreTiling from '../tiling/spectre';
import { generateTileVertices } from '../tiling/shape-param';
import { createCurvyShape, createCurvyShapeFromCurve } from '../tiling/curved';
import type { CurvyShape, EdgeCurveData } from '../tiling/curved';
import { CurveEditor } from '../ui/curve-editor';
import * as marquee from '../interaction/marquee';
import * as piece from '../puzzle/piece';
import * as puzzleModel from '../puzzle/puzzle-model';
import { downloadPuzzleJSON, savePuzzleLocal } from '../puzzle/serialize';
import * as transform from '../geometry/transform';
import * as polygon from '../geometry/polygon';
import * as point from '../geometry/point';
import type { Point } from '../geometry/point';
import type { ClipRect } from '../geometry/clip';

type AnyTile = hatTiling.Tile | spectreTiling.Tile;

interface SelectionFrame {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  angle: number;
}

interface EditorState {
  tiles: AnyTile[];
  selectedIndices: Set<number>;
  curvyShapes: Map<number, CurvyShape>;
  scene: renderer.SceneTransform;
  mode: 'pan' | 'select';
  marqueeState: marquee.MarqueeState | null;
  selectionRect: SelectionFrame | null;
  resizeHandle: string | null;
  dragFrameStart: { cx: number; cy: number; sx: number; sy: number } | null;
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
  tileType: 'hat' | 'spectre';
  depth: number;
  curvedEdges: boolean;
  shapeParam: number;
  customCurveData: EdgeCurveData | null;
}

function createState(): EditorState {
  return {
    tiles: [],
    selectedIndices: new Set(),
    curvyShapes: new Map(),
    scene: renderer.createSceneTransform({ zoom: 1 }),
    mode: 'pan',
    marqueeState: null,
    selectionRect: null,
    resizeHandle: null,
    dragFrameStart: null,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    tileType: 'spectre',
    depth: 2,
    curvedEdges: (() => { try { return localStorage.getItem('spectre-curved-edges') === 'true'; } catch { return false; } })(),
    shapeParam: 1,
    customCurveData: (() => { try { const s = localStorage.getItem('spectre-curve-data'); return s ? JSON.parse(s) as EdgeCurveData : null; } catch { return null; } })(),
  };
}

function hashEdgeMidpoint(ax: number, ay: number, bx: number, by: number): number {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const scaled = Math.round(mx * 1000) * 73856093 ^ Math.round(my * 1000) * 19349669;
  return (scaled % 100000) + 1;
}

function computeSideIds(
  tilePoly: polygon.Polygon,
  allTiles: { poly: polygon.Polygon }[],
  tileIndex: number,
  frameRect: ClipRect | null,
): number[] {
  const verts = tilePoly.vertices;
  const n = verts.length;
  const ids: number[] = [];

  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;

    if (frameRect) {
      const eps = 2;
      const onLeft = Math.abs(mx - frameRect.minX) < eps;
      const onRight = Math.abs(mx - frameRect.maxX) < eps;
      const onTop = Math.abs(my - frameRect.minY) < eps;
      const onBottom = Math.abs(my - frameRect.maxY) < eps;
      if ((onLeft || onRight) && my >= frameRect.minY - eps && my <= frameRect.maxY + eps) {
        ids.push(0);
        continue;
      }
      if ((onTop || onBottom) && mx >= frameRect.minX - eps && mx <= frameRect.maxX + eps) {
        ids.push(0);
        continue;
      }
    }

    let foundAdjacent = false;
    for (let j = 0; j < allTiles.length; j++) {
      if (j === tileIndex) continue;
      const otherVerts = allTiles[j].poly.vertices;
      const m = otherVerts.length;
      for (let k = 0; k < m; k++) {
        const oa = otherVerts[k];
        const ob = otherVerts[(k + 1) % m];
        const omx = (oa.x + ob.x) / 2;
        const omy = (oa.y + ob.y) / 2;
        if (point.distance({ x: mx, y: my }, { x: omx, y: omy }) < 0.5) {
          ids.push(-hashEdgeMidpoint(a.x, a.y, b.x, b.y));
          foundAdjacent = true;
          break;
        }
      }
      if (foundAdjacent) break;
    }

    if (!foundAdjacent) {
      if (frameRect) {
        ids.push(0);
      } else {
        ids.push(hashEdgeMidpoint(a.x, a.y, b.x, b.y));
      }
    }
  }

  return ids;
}

const TILE_PALETTE = [
  '#e8967d', '#7db8c9', '#c4a5d4', '#8cc98c',
  '#d4b87d', '#7da5d4', '#d48a9a', '#a5c4a0',
];

function tileFillColor(index: number, isSelected: boolean): string {
  if (isSelected) {
    return '#f0d080';
  }
  return TILE_PALETTE[index % TILE_PALETTE.length];
}

function tileStrokeColor(isSelected: boolean): string {
  return isSelected ? 'hsl(38, 80%, 40%)' : 'hsl(30, 25%, 35%)';
}

interface BoundaryEdge {
  a: Point;
  b: Point;
}

function traceBoundaryLoops(edges: BoundaryEdge[], eps: number): Point[][] {
  if (edges.length === 0) return [];

  const loops: Point[][] = [];
  const used = new Set<number>();

  while (used.size < edges.length) {
    const startIdx = edges.findIndex((_, i) => !used.has(i));
    if (startIdx === -1) break;

    const loop: Point[] = [edges[startIdx].a];
    used.add(startIdx);
    let currentEnd = edges[startIdx].b;

    for (;;) {
      let foundNext = false;
      for (let i = 0; i < edges.length; i++) {
        if (used.has(i)) continue;
        if (point.distance(edges[i].a, currentEnd) < eps) {
          loop.push(edges[i].a);
          currentEnd = edges[i].b;
          used.add(i);
          foundNext = true;
          break;
        }
      }

      if (!foundNext) break;
      if (point.distance(currentEnd, loop[0]) < eps) break;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

function toFrameLocal(sx: number, sy: number, frame: SelectionFrame): { lx: number; ly: number } {
  const dx = sx - frame.cx;
  const dy = sy - frame.cy;
  const cos = Math.cos(-frame.angle);
  const sin = Math.sin(-frame.angle);
  return { lx: dx * cos - dy * sin, ly: dx * sin + dy * cos };
}

function frameCorners(frame: SelectionFrame): Point[] {
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const localCorners: { x: number; y: number }[] = [
    { x: -frame.hw, y: -frame.hh },
    { x: frame.hw, y: -frame.hh },
    { x: frame.hw, y: frame.hh },
    { x: -frame.hw, y: frame.hh },
  ];
  return localCorners.map(p => ({
    x: p.x * cos - p.y * sin + frame.cx,
    y: p.x * sin + p.y * cos + frame.cy,
  }));
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-20) return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
}

function hitTestHandle(sx: number, sy: number, frame: SelectionFrame, zoom: number): string | null {
  const threshold = 8 / zoom;
  const { lx, ly } = toFrameLocal(sx, sy, frame);

  const rotOffset = 25 / zoom;
  const rdx = lx;
  const rdy = ly - (-frame.hh - rotOffset);
  if (rdx * rdx + rdy * rdy < threshold * threshold) {
    return 'rotate';
  }

  const closeR = 8 / zoom;
  const closeX = frame.hw + closeR + 4 / zoom;
  const closeY = -frame.hh - closeR - 4 / zoom;
  const cdx = lx - closeX;
  const cdy = ly - closeY;
  if (cdx * cdx + cdy * cdy < (closeR + threshold) * (closeR + threshold)) {
    return 'close';
  }

  const handlePositions: { lx: number; ly: number; name: string }[] = [
    { lx: -frame.hw, ly: -frame.hh, name: 'nw' },
    { lx: 0, ly: -frame.hh, name: 'n' },
    { lx: frame.hw, ly: -frame.hh, name: 'ne' },
    { lx: frame.hw, ly: 0, name: 'e' },
    { lx: frame.hw, ly: frame.hh, name: 'se' },
    { lx: 0, ly: frame.hh, name: 's' },
    { lx: -frame.hw, ly: frame.hh, name: 'sw' },
    { lx: -frame.hw, ly: 0, name: 'w' },
  ];

  for (const hp of handlePositions) {
    const dx = lx - hp.lx;
    const dy = ly - hp.ly;
    if (dx * dx + dy * dy < threshold * threshold) {
      return hp.name;
    }
  }

  return null;
}

function resizeSelectionFrame(frame: SelectionFrame, handle: string, sx: number, sy: number): SelectionFrame {
  const { lx, ly } = toFrameLocal(sx, sy, frame);

  let left = -frame.hw;
  let right = frame.hw;
  let top = -frame.hh;
  let bottom = frame.hh;

  if (handle.includes('e')) right = lx;
  if (handle.includes('w')) left = lx;
  if (handle.includes('n')) top = ly;
  if (handle.includes('s')) bottom = ly;

  if (right - left < 2) { if (handle.includes('e')) right = left + 2; else left = right - 2; }
  if (bottom - top < 2) { if (handle.includes('s')) bottom = top + 2; else top = bottom - 2; }

  const newLocalCx = (left + right) / 2;
  const newLocalCy = (top + bottom) / 2;
  const newHw = (right - left) / 2;
  const newHh = (bottom - top) / 2;

  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);

  return {
    cx: frame.cx + newLocalCx * cos - newLocalCy * sin,
    cy: frame.cy + newLocalCx * sin + newLocalCy * cos,
    hw: newHw,
    hh: newHh,
    angle: frame.angle,
  };
}

function isInsideFrame(sx: number, sy: number, frame: SelectionFrame): boolean {
  const { lx, ly } = toFrameLocal(sx, sy, frame);
  return Math.abs(lx) <= frame.hw && Math.abs(ly) <= frame.hh;
}

function updateSelectionFromRect(state: EditorState): void {
  if (!state.selectionRect) return;
  const frame = state.selectionRect;
  state.selectedIndices = new Set();

  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    const worldPoly = transform.applyToPolygon(t.transform, t.polygon);

    let allInside = true;
    for (const v of worldPoly.vertices) {
      const { lx, ly } = toFrameLocal(v.x, v.y, frame);
      if (lx < -frame.hw || lx > frame.hw || ly < -frame.hh || ly > frame.hh) {
        allInside = false;
        break;
      }
    }

    if (allInside) {
      state.selectedIndices.add(i);
    }
  }
}

function applyCustomCurve(state: EditorState): void {
  if (!state.customCurveData || !state.curvedEdges) return;
  state.curvyShapes.clear();
  for (let i = 0; i < state.tiles.length; i++) {
    const worldPoly = transform.applyToPolygon(state.tiles[i].transform, state.tiles[i].polygon);
    state.curvyShapes.set(i, createCurvyShapeFromCurve(worldPoly, state.customCurveData));
  }
}

function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: EditorState,
): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  renderer.applyToCtx(ctx, state.scene);

  const total = state.tiles.length;

  for (let i = 0; i < total; i++) {
    const tile = state.tiles[i];
    const isSelected = state.selectedIndices.has(i);
    const worldPoly = transform.applyToPolygon(tile.transform, tile.polygon);

    ctx.fillStyle = tileFillColor(i, isSelected);
    ctx.strokeStyle = tileStrokeColor(isSelected);
    ctx.lineWidth = isSelected ? 3 / state.scene.zoom : 1.5 / state.scene.zoom;

    if (state.curvedEdges && state.curvyShapes.has(i)) {
      const curvy = state.curvyShapes.get(i)!;
      curvy.toCanvasPath(ctx);
      ctx.fill();
      ctx.stroke();
    } else {
      const verts = worldPoly.vertices;
      if (verts.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let j = 1; j < verts.length; j++) {
        ctx.lineTo(verts[j].x, verts[j].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  if (state.marqueeState) {
    const ms = state.marqueeState;
    const minSX = Math.min(ms.startX, ms.endX);
    const minSY = Math.min(ms.startY, ms.endY);
    const w = Math.abs(ms.endX - ms.startX);
    const h = Math.abs(ms.endY - ms.startY);

    ctx.strokeStyle = 'rgba(139, 105, 20, 0.9)';
    ctx.lineWidth = 2 / state.scene.zoom;
    ctx.setLineDash([6 / state.scene.zoom, 4 / state.scene.zoom]);
    ctx.strokeRect(minSX, minSY, w, h);
    ctx.fillStyle = 'rgba(139, 105, 20, 0.1)';
    ctx.fillRect(minSX, minSY, w, h);
    ctx.setLineDash([]);
  }

  if (state.selectionRect) {
    const frame = state.selectionRect;

    ctx.save();
    ctx.translate(frame.cx, frame.cy);
    ctx.rotate(frame.angle);

    ctx.strokeStyle = 'rgba(139, 105, 20, 0.9)';
    ctx.lineWidth = 2 / state.scene.zoom;
    ctx.setLineDash([]);
    ctx.strokeRect(-frame.hw, -frame.hh, frame.hw * 2, frame.hh * 2);
    ctx.fillStyle = 'rgba(139, 105, 20, 0.06)';
    ctx.fillRect(-frame.hw, -frame.hh, frame.hw * 2, frame.hh * 2);

    const hr = 5 / state.scene.zoom;
    const handles: { x: number; y: number }[] = [
      { x: -frame.hw, y: -frame.hh },
      { x: 0, y: -frame.hh },
      { x: frame.hw, y: -frame.hh },
      { x: frame.hw, y: 0 },
      { x: frame.hw, y: frame.hh },
      { x: 0, y: frame.hh },
      { x: -frame.hw, y: frame.hh },
      { x: -frame.hw, y: 0 },
    ];
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(139, 105, 20, 0.9)';
    ctx.lineWidth = 1.5 / state.scene.zoom;
    for (const h of handles) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    const rotOffset = 25 / state.scene.zoom;
    ctx.beginPath();
    ctx.moveTo(0, -frame.hh);
    ctx.lineTo(0, -frame.hh - rotOffset);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -frame.hh - rotOffset, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const closeR = 8 / state.scene.zoom;
    const closeX = frame.hw + closeR + 4 / state.scene.zoom;
    const closeY = -frame.hh - closeR - 4 / state.scene.zoom;
    ctx.fillStyle = 'rgba(180, 60, 60, 0.9)';
    ctx.beginPath();
    ctx.arc(closeX, closeY, closeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / state.scene.zoom;
    const xr = closeR * 0.5;
    ctx.beginPath();
    ctx.moveTo(closeX - xr, closeY - xr);
    ctx.lineTo(closeX + xr, closeY + xr);
    ctx.moveTo(closeX + xr, closeY - xr);
    ctx.lineTo(closeX - xr, closeY + xr);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(139, 105, 20, 0.9)';

    const arrowGap = 6 / state.scene.zoom;
    const arrowLen = 10 / state.scene.zoom;
    const arrowW = 5 / state.scene.zoom;
    ctx.fillStyle = 'rgba(139, 105, 20, 0.7)';
    const midpoints = [
      { x: 0, y: -frame.hh, dx: 0, dy: -1 },
      { x: 0, y: frame.hh, dx: 0, dy: 1 },
      { x: -frame.hw, y: 0, dx: -1, dy: 0 },
      { x: frame.hw, y: 0, dx: 1, dy: 0 },
    ];
    for (const m of midpoints) {
      const ox = m.x + m.dx * arrowGap;
      const oy = m.y + m.dy * arrowGap;
      const tx = ox + m.dx * arrowLen;
      const ty = oy + m.dy * arrowLen;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ox + m.dx * arrowLen * 0.2 - m.dy * arrowW, oy + m.dy * arrowLen * 0.2 + m.dx * arrowW);
      ctx.lineTo(ox + m.dx * arrowLen * 0.2 + m.dy * arrowW, oy + m.dy * arrowLen * 0.2 - m.dx * arrowW);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  ctx.restore();
}

function updateStatus(state: EditorState): void {
  const tilesEl = document.getElementById('status-tiles');
  const selectedEl = document.getElementById('status-selected');
  const modeEl = document.getElementById('status-mode');
  if (tilesEl) tilesEl.textContent = `Tiles: ${state.tiles.length}`;
  if (selectedEl) selectedEl.textContent = `Selected: ${state.selectedIndices.size}`;
  if (modeEl) modeEl.textContent = `Mode: ${state.mode === 'pan' ? 'Pan' : 'Select'}`;
}

function resizeCanvas(canvas: HTMLCanvasElement, container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  canvas.width = Math.floor(rect.width);
  canvas.height = Math.floor(rect.height);
}

function buildWorldPolyList(tiles: AnyTile[]): { poly: polygon.Polygon }[] {
  return tiles.map(t => ({
    poly: transform.applyToPolygon(t.transform, t.polygon),
  }));
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('main-canvas') as HTMLCanvasElement | null;
  const canvasArea = document.getElementById('canvas-area');
  const btnGenerate = document.getElementById('btn-generate');
  const btnSelect = document.getElementById('btn-select');
  const btnLocalSave = document.getElementById('btn-local-save');
  const btnExport = document.getElementById('btn-export');
  const depthSlider = document.getElementById('depth-slider') as HTMLInputElement | null;
  const depthValue = document.getElementById('depth-value');
  const curvedCheckbox = document.getElementById('curved-edges') as HTMLInputElement | null;
  const curvedGroup = document.getElementById('curved-group');
  const curveEditorGroup = document.getElementById('curve-editor-group');
  const shapeSlider = document.getElementById('shape-slider') as HTMLInputElement | null;
  const shapeValue = document.getElementById('shape-value');

  if (!canvas || !canvasArea) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const state = createState();
  resizeCanvas(canvas, canvasArea as HTMLElement);

  state.scene = renderer.createSceneTransform({
    zoom: 1,
    centerX: canvas.width / 2,
    centerY: canvas.height / 2,
  });

  if (curvedCheckbox && state.curvedEdges) curvedCheckbox.checked = true;
  const persistedStatus = document.getElementById('curve-status');
  if (persistedStatus && state.customCurveData) persistedStatus.textContent = 'Custom curve applied';
  updateTileTypeFromRadio();
  updateStatus(state);

  function getSelectedTileType(): 'hat' | 'spectre' {
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="tile-type"]');
    for (const r of radios) {
      if (r.checked) return r.value as 'hat' | 'spectre';
    }
    return 'spectre';
  }

  function updateTileTypeFromRadio(): void {
    state.tileType = getSelectedTileType();
    if (curvedGroup) {
      curvedGroup.style.display = state.tileType === 'spectre' ? '' : 'none';
    }
    if (curveEditorGroup) {
      curveEditorGroup.style.display =
        state.tileType === 'spectre' && state.curvedEdges ? '' : 'none';
    }
  }

  document.querySelectorAll('input[name="tile-type"]').forEach(radio => {
    radio.addEventListener('change', updateTileTypeFromRadio);
  });

  if (depthSlider) {
    depthSlider.addEventListener('input', () => {
      state.depth = parseInt(depthSlider.value, 10);
      if (depthValue) depthValue.textContent = depthSlider.value;
    });
  }

  if (shapeSlider) {
    shapeSlider.addEventListener('input', () => {
      const raw = parseInt(shapeSlider.value, 10);
      state.shapeParam = raw / 100;
      if (shapeValue) {
        if (raw === 0) shapeValue.textContent = 'Hat';
        else if (raw === 100) shapeValue.textContent = 'Spectre';
        else shapeValue.textContent = `${raw}%`;
      }
    });
  }

  if (curvedCheckbox) {
    curvedCheckbox.addEventListener('change', () => {
      state.curvedEdges = curvedCheckbox.checked;
      try { localStorage.setItem('spectre-curved-edges', String(state.curvedEdges)); } catch { /* ignore */ }
      if (curveEditorGroup) {
        curveEditorGroup.style.display =
          state.tileType === 'spectre' && state.curvedEdges ? '' : 'none';
      }
    });
  }

  const btnEditCurve = document.getElementById('btn-edit-curve');
  const curveStatusEl = document.getElementById('curve-status');
  if (btnEditCurve) {
    btnEditCurve.addEventListener('click', async () => {
      const modalEl = document.getElementById('curve-editor-modal');
      if (!modalEl) return;
      const editor = new CurveEditor(modalEl);
      const result = await editor.open(state.customCurveData ?? undefined);
      if (result) {
        state.customCurveData = result;
        try { localStorage.setItem('spectre-curve-data', JSON.stringify(result)); } catch { /* ignore */ }
        if (curveStatusEl) curveStatusEl.textContent = 'Custom curve applied';
        applyCustomCurve(state);
        render(ctx, canvas, state);
      }
      editor.destroy();
    });
  }

  if (btnGenerate) {
    btnGenerate.addEventListener('click', () => {
      state.tiles = [];
      state.selectedIndices.clear();
      state.curvyShapes.clear();
      state.marqueeState = null;

      const w = 800;
      const h = 600;

      if (state.tileType === 'hat') {
        state.tiles = hatTiling.generateHatTiling(w, h, state.depth);
      } else {
        state.tiles = spectreTiling.generateSpectreTiling(w, h, state.depth);
      }

      if (state.shapeParam > 0 && state.shapeParam < 1) {
        const paramVerts = generateTileVertices(state.shapeParam);
        for (const tile of state.tiles) {
          const localVerts = transform.applyToPolygon(
            transform.inverse(tile.transform),
            tile.polygon,
          );
          const centroid = polygon.centroid(localVerts);
          const replacement = polygon.create(
            paramVerts.map(v => point.add(v, centroid)),
          );
          tile.polygon = transform.applyToPolygon(tile.transform, replacement);
        }
      }

      if (state.curvedEdges && state.tileType === 'spectre') {
        if (state.customCurveData) {
          for (let i = 0; i < state.tiles.length; i++) {
            const worldPoly = transform.applyToPolygon(state.tiles[i].transform, state.tiles[i].polygon);
            state.curvyShapes.set(i, createCurvyShapeFromCurve(worldPoly, state.customCurveData));
          }
        } else {
          for (let i = 0; i < state.tiles.length; i++) {
            const worldPoly = transform.applyToPolygon(state.tiles[i].transform, state.tiles[i].polygon);
            state.curvyShapes.set(i, createCurvyShape(worldPoly));
          }
        }
      }

      if (state.tiles.length > 0) {
        const allPolys = state.tiles.map(t => transform.applyToPolygon(t.transform, t.polygon));
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of allPolys) {
          const bb = polygon.boundingBox(p);
          if (bb.min.x < minX) minX = bb.min.x;
          if (bb.min.y < minY) minY = bb.min.y;
          if (bb.max.x > maxX) maxX = bb.max.x;
          if (bb.max.y > maxY) maxY = bb.max.y;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        const padding = 40;
        const zoomX = canvas.width / (maxX - minX + padding);
        const zoomY = canvas.height / (maxY - minY + padding);
        const autoZoom = Math.min(zoomX, zoomY);

        state.scene = renderer.createSceneTransform({
          zoom: autoZoom,
          centerX: cx,
          centerY: cy,
          panX: canvas.width / 2 - cx,
          panY: canvas.height / 2 - cy,
        });
      }

      updateStatus(state);
      render(ctx, canvas, state);
    });
  }

  if (btnSelect) {
    btnSelect.addEventListener('click', () => {
      if (state.mode === 'select') {
        state.mode = 'pan';
        btnSelect.classList.remove('btn-active');
      } else {
        state.mode = 'select';
        btnSelect.classList.add('btn-active');
      }
      updateStatus(state);
    });
  }

  function buildPuzzleModelFromSelection(state: EditorState): puzzleModel.PuzzleModel | null {
    if (state.selectedIndices.size === 0) {
      window.alert('Select a region first');
      return null;
    }

    const selectedIndices = Array.from(state.selectedIndices);
    const selectedTiles = selectedIndices.map(i => state.tiles[i]);
    if (selectedTiles.length === 0) return null;

    const selectedWorldPolys = selectedTiles.map(t =>
      transform.applyToPolygon(t.transform, t.polygon)
    );

    if (!state.selectionRect) return null;
    const corners = frameCorners(state.selectionRect);

    const framePolygon = polygon.create([...corners]);

    const allWorldPolyList = buildWorldPolyList(state.tiles);
    const selectedGlobalSet = new Set(selectedIndices);

    const pieces: piece.Piece[] = [];
    const solutionMap = new Map<number, transform.AffineTransform>();
    let nextPieceId = 1;

    const EDGE_EPS = 0.5;

    for (let si = 0; si < selectedTiles.length; si++) {
      const worldPoly = selectedWorldPolys[si];
      const globalIdx = selectedIndices[si];
      const verts = worldPoly.vertices;
      const sideIds: number[] = [];

      for (let ei = 0; ei < verts.length; ei++) {
        const a = verts[ei];
        const b = verts[(ei + 1) % verts.length];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;

        {
          const feps = 2;
          let onFrameEdge = false;
          for (let ci = 0; ci < 4; ci++) {
            const ca = corners[ci];
            const cb = corners[(ci + 1) % 4];
            if (pointToSegmentDist(mx, my, ca.x, ca.y, cb.x, cb.y) < feps) {
              onFrameEdge = true;
              break;
            }
          }
          if (onFrameEdge) {
            sideIds.push(0);
            continue;
          }
        }

        let foundAdjacent = false;
        for (let gi = 0; gi < state.tiles.length; gi++) {
          if (selectedGlobalSet.has(gi)) continue;
          const otherPoly = allWorldPolyList[gi].poly;
          const otherVerts = otherPoly.vertices;
          const m = otherVerts.length;
          for (let k = 0; k < m; k++) {
            const oa = otherVerts[k];
            const ob = otherVerts[(k + 1) % m];
            const omx = (oa.x + ob.x) / 2;
            const omy = (oa.y + ob.y) / 2;
            if (point.distance({ x: mx, y: my }, { x: omx, y: omy }) < EDGE_EPS) {
              sideIds.push(-hashEdgeMidpoint(a.x, a.y, b.x, b.y));
              foundAdjacent = true;
              break;
            }
          }
          if (foundAdjacent) break;
        }

        if (foundAdjacent) continue;

        let foundOther = false;
        for (let sj = 0; sj < selectedTiles.length; sj++) {
          if (sj === si) continue;
          const otherPoly = selectedWorldPolys[sj];
          const otherVerts = otherPoly.vertices;
          const m = otherVerts.length;
          for (let k = 0; k < m; k++) {
            const oa = otherVerts[k];
            const ob = otherVerts[(k + 1) % m];
            const omx = (oa.x + ob.x) / 2;
            const omy = (oa.y + ob.y) / 2;
            if (point.distance({ x: mx, y: my }, { x: omx, y: omy }) < EDGE_EPS) {
              const edgeHash = hashEdgeMidpoint(a.x, a.y, b.x, b.y);
              // Complementary IDs: lower global index gets +hash, higher gets -hash
              // so sideA.id + sideB.id === 0 for snapping
              sideIds.push(globalIdx < selectedIndices[sj] ? edgeHash : -edgeHash);
              foundOther = true;
              break;
            }
          }
          if (foundOther) break;
        }

        if (!foundOther) {
          sideIds.push(0);
        }
      }

      const id = nextPieceId++;
      const p = piece.createPiece(id, worldPoly, transform.identity(), sideIds, false);
      pieces.push(p);
      solutionMap.set(id, transform.identity());
    }

    // frameTilePolys = selected tile polygons → holes in the frame where pieces go
    const frameTilePolys: polygon.Polygon[] = selectedWorldPolys.slice();

    return puzzleModel.createPuzzleModel(pieces, framePolygon, solutionMap, frameTilePolys);
  }

  if (btnLocalSave) {
    btnLocalSave.addEventListener('click', () => {
      const model = buildPuzzleModelFromSelection(state);
      if (!model) return;
      try {
        savePuzzleLocal(model, state.tileType, state.curvedEdges, state.customCurveData);
        const orig = btnLocalSave.textContent;
        btnLocalSave.textContent = 'Saved!';
        setTimeout(() => { btnLocalSave.textContent = orig; }, 2000);
      } catch {
        window.alert('Failed to save puzzle');
      }
    });
  }

  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const model = buildPuzzleModelFromSelection(state);
      if (!model) return;
      downloadPuzzleJSON(model, 'puzzle.json', state.tileType, state.curvedEdges, state.customCurveData);
    });
  }

  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.1, Math.min(50, state.scene.zoom * zoomFactor));

    state.scene = { ...state.scene, zoom: newZoom };
    render(ctx, canvas, state);
  }, { passive: false });

  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (state.mode === 'select' && e.button === 0) {
      const scenePt = renderer.screenToScene(state.scene, mx, my);

      if (state.selectionRect) {
        const handle = hitTestHandle(scenePt.x, scenePt.y, state.selectionRect, state.scene.zoom);
        if (handle === 'close') {
          state.selectionRect = null;
          state.selectedIndices = new Set();
          updateStatus(state);
          render(ctx, canvas, state);
          return;
        }
        if (handle) {
          state.resizeHandle = handle;
          state.isDragging = true;
          return;
        }
        if (isInsideFrame(scenePt.x, scenePt.y, state.selectionRect)) {
          state.dragFrameStart = {
            cx: state.selectionRect.cx,
            cy: state.selectionRect.cy,
            sx: scenePt.x,
            sy: scenePt.y,
          };
          state.isDragging = true;
          return;
        }
        return;
      }

      state.marqueeState = marquee.startSelection(scenePt.x, scenePt.y);
      state.isDragging = true;
    } else if (e.button === 1 || e.button === 0) {
      state.isDragging = true;
      state.dragStartX = mx;
      state.dragStartY = my;
    }
  });

  canvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (!state.isDragging) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (state.mode === 'select' && state.marqueeState) {
      const scenePt = renderer.screenToScene(state.scene, mx, my);
      state.marqueeState = marquee.updateSelection(state.marqueeState, scenePt.x, scenePt.y);
      render(ctx, canvas, state);
    } else if (state.mode === 'select' && state.dragFrameStart && state.selectionRect) {
      const scenePt = renderer.screenToScene(state.scene, mx, my);
      const dx = scenePt.x - state.dragFrameStart.sx;
      const dy = scenePt.y - state.dragFrameStart.sy;
      state.selectionRect = {
        ...state.selectionRect,
        cx: state.dragFrameStart.cx + dx,
        cy: state.dragFrameStart.cy + dy,
      };
      updateSelectionFromRect(state);
      render(ctx, canvas, state);
    } else if (state.mode === 'select' && state.resizeHandle && state.selectionRect) {
      const scenePt = renderer.screenToScene(state.scene, mx, my);
      if (state.resizeHandle === 'rotate') {
        state.selectionRect = {
          ...state.selectionRect,
          angle: Math.atan2(scenePt.y - state.selectionRect.cy, scenePt.x - state.selectionRect.cx) + Math.PI / 2,
        };
      } else {
        state.selectionRect = resizeSelectionFrame(state.selectionRect, state.resizeHandle, scenePt.x, scenePt.y);
      }
      updateSelectionFromRect(state);
      render(ctx, canvas, state);
    } else if (e.buttons === 4 || e.buttons === 1) {
      const dx = mx - state.dragStartX;
      const dy = my - state.dragStartY;
      state.scene = renderer.withPan(state.scene, state.scene.panX + dx, state.scene.panY + dy);
      state.dragStartX = mx;
      state.dragStartY = my;
      render(ctx, canvas, state);
    }
  });

  canvas.addEventListener('mouseup', (e: MouseEvent) => {
    if (state.mode === 'select' && state.marqueeState) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scenePt = renderer.screenToScene(state.scene, mx, my);
      state.marqueeState = marquee.updateSelection(state.marqueeState, scenePt.x, scenePt.y);

      const selRect = marquee.endSelection(state.marqueeState);
      state.selectionRect = {
        cx: (selRect.minX + selRect.maxX) / 2,
        cy: (selRect.minY + selRect.maxY) / 2,
        hw: (selRect.maxX - selRect.minX) / 2,
        hh: (selRect.maxY - selRect.minY) / 2,
        angle: 0,
      };

      updateSelectionFromRect(state);

      state.marqueeState = null;
      updateStatus(state);
      render(ctx, canvas, state);
    }

    if (state.resizeHandle) {
      state.resizeHandle = null;
      updateStatus(state);
    }

    if (state.dragFrameStart) {
      state.dragFrameStart = null;
    }

    state.isDragging = false;
  });

  canvas.addEventListener('mouseleave', () => {
    state.isDragging = false;
  });

  window.addEventListener('resize', () => {
    resizeCanvas(canvas, canvasArea as HTMLElement);
    render(ctx, canvas, state);
  });
});
