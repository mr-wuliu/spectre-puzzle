import type { Point } from '../geometry/point';
import type { AffineTransform } from '../geometry/transform';
import type { PuzzleModel } from '../puzzle/puzzle-model';
import type { Piece } from '../puzzle/piece';
import type { Polygon } from '../geometry/polygon';
import type { SceneTransform } from '../render/renderer';

import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';
import { findSnapTarget } from '../puzzle/snap';
import { checkWinCondition, SolutionRevealer } from '../puzzle/win';
import { importPuzzle, listSavedPuzzles, loadSavedPuzzle, deleteSavedPuzzle } from '../puzzle/serialize';
import type { EdgeCurveData } from '../tiling/curved';
import { createCurvyShape, createCurvyShapeFromCurve } from '../tiling/curved';
import {
  createSceneTransform,
  screenToScene,
  applyToCtx,
} from '../render/renderer';
import { AnimationManager } from '../render/animation';

interface DragInfo {
  pieceId: number;
  anchorOffset: Point;
  startRotation: number;
  groupIds: number[];
  startScenePt: Point;
  startTransforms: Map<number, AffineTransform>;
}

interface RotateDragInfo {
  pieceId: number;
  startAngle: number;
  startRotation: number;
  pivotX: number;
  pivotY: number;
}

interface MarqueeInfo {
  start: Point;
  current: Point;
}

type TrayPieceKind = 'normal' | 'chiral';

const ROTATION_STEP = Math.PI / 6;
const THUMBNAIL_SIZE = 72;
const ROTATE_HANDLE_RADIUS = 8;
const SOLVE_SNAP_THRESHOLD = 0.4;
const SOLVE_SNAP_ANGLE_THRESHOLD = Math.PI / 18;
const SOLVE_SNAP_GEOMETRIC_MATCH = true;
const SOLVE_SNAP_INCLUDE_BOUNDARY_EDGES = true;

let puzzle: PuzzleModel | null = null;
let initialJSON = '';
let sceneXform: SceneTransform = createSceneTransform();
let dragInfo: DragInfo | null = null;
let rotateDragInfo: RotateDragInfo | null = null;
let marqueeInfo: MarqueeInfo | null = null;
let selectedPieceIds = new Set<number>();
let selectedTrayPieceKind: TrayPieceKind | null = null;
let won = false;
let hoveredPieceId: number | null = null;
let pieceColorMap = new Map<number, { fill: string; stroke: string }>();
let curvedEdges = false;
let curveData: EdgeCurveData | null = null;
const anim = new AnimationManager();

function pieceColor(id: number, poly: Polygon): { fill: string; stroke: string } {
  let c = pieceColorMap.get(id);
  if (c) return c;
  const chiral = polygon.area(poly) < 0;
  c = chiral
    ? { fill: 'rgba(200, 80, 160, 0.45)', stroke: 'rgba(180, 50, 140, 0.85)' }
    : { fill: 'rgba(100, 170, 220, 0.45)', stroke: 'rgba(60, 130, 190, 0.85)' };
  pieceColorMap.set(id, c);
  return c;
}

function pieceKind(poly: Polygon): TrayPieceKind {
  return polygon.area(poly) < 0 ? 'chiral' : 'normal';
}

function transformFromCentroid(
  worldCentroid: Point,
  localCentroid: Point,
  rotation: number,
): AffineTransform {
  return transform.compose(
    transform.translation(worldCentroid.x, worldCentroid.y),
    transform.compose(
      transform.rotation(rotation),
      transform.translation(-localCentroid.x, -localCentroid.y),
    ),
  );
}

function canonicalPieceRotation(piece: Piece): number {
  const side = piece.sides[0];
  if (!side) return 0;
  return -Math.atan2(side.ptB.y - side.ptA.y, side.ptB.x - side.ptA.x);
}

function buildColorMap(): void {
  pieceColorMap.clear();
  if (!puzzle) return;
  puzzle.pieces.forEach((p) => pieceColor(p.id, p.polygon));
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(dpr, dpr);
}

function canvasLogicalSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  return { w: canvas.width / dpr, h: canvas.height / dpr };
}

function centerView(canvas: HTMLCanvasElement): void {
  if (!puzzle) return;
  const { w, h } = canvasLogicalSize(canvas);
  const bbox = polygon.boundingBox(puzzle.framePolygon);
  const fcx = (bbox.min.x + bbox.max.x) / 2;
  const fcy = (bbox.min.y + bbox.max.y) / 2;
  const fw = bbox.max.x - bbox.min.x;
  const fh = bbox.max.y - bbox.min.y;
  const padding = 0.85;
  const zx = fw > 0 ? (w * padding) / fw : 1;
  const zy = fh > 0 ? (h * padding) / fh : 1;
  const zoom = Math.min(zx, zy, 100);
  const panX = w / 2 - fcx * zoom;
  const panY = h / 2 - fcy * zoom;
  sceneXform = createSceneTransform({
    panX,
    panY,
    zoom,
    centerX: 0,
    centerY: 0,
    rotation: 0,
  });
}

function toScene(e: PointerEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return screenToScene(sceneXform, e.clientX - rect.left, e.clientY - rect.top);
}

function render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const { w, h } = canvasLogicalSize(canvas);
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  if (!puzzle) {
    ctx.restore();
    return;
  }

  ctx.save();
  applyToCtx(ctx, sceneXform);
  drawFrame(ctx, puzzle.framePolygon, puzzle.frameTilePolygons);

  const placed = puzzle.pieces.filter((p) => p.isPlaced);
  for (const p of placed) {
    const isDragging = dragInfo !== null && dragInfo.pieceId === p.id;
    drawPiece(ctx, p, isDragging || selectedPieceIds.has(p.id));
  }

  for (const p of placed) {
    drawRotateHandle(ctx, p);
  }

  if (marqueeInfo !== null) {
    drawMarquee(ctx, marqueeInfo);
  }

  ctx.restore();
  ctx.restore();
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: Polygon,
  frameTilePolys: Polygon[],
): void {
  const verts = frame.vertices;
  if (verts.length < 3) return;

  ctx.save();

  if (frameTilePolys.length > 0) {
    const path = new Path2D();
    path.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) path.lineTo(verts[i].x, verts[i].y);
    path.closePath();

    for (const ftp of frameTilePolys) {
      const tilePath = buildPiecePath(ftp);
      path.addPath(tilePath);
    }

    ctx.fillStyle = 'rgba(232, 220, 200, 0.3)';
    ctx.fill(path, 'evenodd');

    drawFrameTileBoundary(ctx, frameTilePolys);

    const outerPath = new Path2D();
    outerPath.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) outerPath.lineTo(verts[i].x, verts[i].y);
    outerPath.closePath();
    ctx.strokeStyle = '#3f3320';
    ctx.lineWidth = 4 / sceneXform.zoom;
    ctx.setLineDash([8 / sceneXform.zoom, 4 / sceneXform.zoom]);
    ctx.stroke(outerPath);
    ctx.setLineDash([]);
  } else {
    const path = new Path2D();
    path.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) path.lineTo(verts[i].x, verts[i].y);
    path.closePath();
    ctx.strokeStyle = '#3f3320';
    ctx.lineWidth = 4 / sceneXform.zoom;
    ctx.setLineDash([8 / sceneXform.zoom, 4 / sceneXform.zoom]);
    ctx.stroke(path);
    ctx.fillStyle = 'rgba(232, 220, 200, 0.25)';
    ctx.fill(path);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawFrameTileBoundary(
  ctx: CanvasRenderingContext2D,
  frameTilePolys: Polygon[],
): void {
  const edgeCounts = new Map<string, number>();
  const edges: Array<{ key: string; polyIndex: number; edgeIndex: number }> = [];

  for (let polyIndex = 0; polyIndex < frameTilePolys.length; polyIndex++) {
    const poly = frameTilePolys[polyIndex];
    const verts = poly.vertices;
    for (let i = 0; i < verts.length; i++) {
      const from = verts[i];
      const to = verts[(i + 1) % verts.length];
      const key = undirectedEdgeKey(from, to);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      edges.push({ key, polyIndex, edgeIndex: i });
    }
  }

  ctx.save();
  ctx.beginPath();
  for (const edge of edges) {
    if (edgeCounts.get(edge.key) !== 1) continue;
    addCurvedBoundaryEdge(ctx, frameTilePolys[edge.polyIndex], edge.edgeIndex);
  }
  ctx.strokeStyle = '#5b3f1f';
  ctx.lineWidth = 2.5 / sceneXform.zoom;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

function addCurvedBoundaryEdge(
  ctx: CanvasRenderingContext2D,
  poly: Polygon,
  edgeIndex: number,
): void {
  if (!curvedEdges || poly.vertices.length < 3) {
    const from = poly.vertices[edgeIndex];
    const to = poly.vertices[(edgeIndex + 1) % poly.vertices.length];
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    return;
  }

  const shape = curveData
    ? createCurvyShapeFromCurve(poly, curveData)
    : createCurvyShape(poly);
  const segmentsPerEdge = shape.segments.length / poly.vertices.length;
  const start = Math.round(edgeIndex * segmentsPerEdge);
  const end = Math.round((edgeIndex + 1) * segmentsPerEdge);
  const first = shape.segments[start];
  if (!first) return;

  ctx.moveTo(first.from.x, first.from.y);
  for (let i = start; i < end; i++) {
    const seg = shape.segments[i];
    if (!seg) continue;
    ctx.bezierCurveTo(
      seg.cp1.x,
      seg.cp1.y,
      seg.cp2.x,
      seg.cp2.y,
      seg.to.x,
      seg.to.y,
    );
  }
}

function undirectedEdgeKey(a: Point, b: Point): string {
  const ak = pointKey(a);
  const bk = pointKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function pointKey(p: Point): string {
  return `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
}

function buildPiecePath(poly: Polygon): Path2D {
  const verts = poly.vertices;
  if (!curvedEdges || verts.length < 3) {
    const path = new Path2D();
    path.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) path.lineTo(verts[i].x, verts[i].y);
    path.closePath();
    return path;
  }
  const shape = curveData
    ? createCurvyShapeFromCurve(poly, curveData)
    : createCurvyShape(poly);
  const path = new Path2D();
  path.moveTo(verts[0].x, verts[0].y);
  for (const seg of shape.segments) {
    path.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.to.x, seg.to.y);
  }
  path.closePath();
  return path;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  highlight: boolean,
): void {
  const worldPoly = transform.applyToPolygon(piece.transform, piece.polygon);
  if (worldPoly.vertices.length < 3) return;
  const path = buildPiecePath(worldPoly);

  const colors = pieceColor(piece.id, piece.polygon);
  ctx.save();
  ctx.fillStyle = highlight
    ? colors.stroke.replace('0.85', '0.55')
    : colors.fill;
  ctx.fill(path);

  ctx.strokeStyle = highlight ? '#8b6914' : colors.stroke;
  ctx.lineWidth = (highlight ? 3 : 1.5) / sceneXform.zoom;
  ctx.stroke(path);

  if (highlight) {
    ctx.shadowColor = 'rgba(139, 105, 20, 0.6)';
    ctx.shadowBlur = 8 / sceneXform.zoom;
    ctx.stroke(path);
    ctx.shadowColor = 'transparent';
  }
  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, marquee: MarqueeInfo): void {
  const minX = Math.min(marquee.start.x, marquee.current.x);
  const minY = Math.min(marquee.start.y, marquee.current.y);
  const maxX = Math.max(marquee.start.x, marquee.current.x);
  const maxY = Math.max(marquee.start.y, marquee.current.y);

  ctx.save();
  ctx.fillStyle = 'rgba(139, 105, 20, 0.12)';
  ctx.strokeStyle = 'rgba(139, 105, 20, 0.9)';
  ctx.lineWidth = 1.5 / sceneXform.zoom;
  ctx.setLineDash([5 / sceneXform.zoom, 3 / sceneXform.zoom]);
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  ctx.restore();
}

function getRotateHandlePos(piece: Piece): { x: number; y: number; pivotX: number; pivotY: number } {
  const localCentroid = polygon.centroid(piece.polygon);
  const worldCentroid = transform.applyToPoint(piece.transform, localCentroid);
  const pivotX = worldCentroid.x;
  const pivotY = worldCentroid.y;
  return {
    x: pivotX,
    y: pivotY,
    pivotX,
    pivotY,
  };
}

function drawRotateHandle(ctx: CanvasRenderingContext2D, piece: Piece): void {
  const { x: handleX, y: handleY } = getRotateHandlePos(piece);
  const hr = ROTATE_HANDLE_RADIUS / sceneXform.zoom;

  ctx.save();
  ctx.beginPath();
  ctx.arc(handleX, handleY, hr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(139, 105, 20, 0.85)';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2 / sceneXform.zoom;
  ctx.stroke();

  const ar = hr * 0.4;
  ctx.beginPath();
  ctx.arc(handleX, handleY, ar, -Math.PI * 0.7, Math.PI * 0.5);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5 / sceneXform.zoom;
  ctx.stroke();
  ctx.restore();
}

function hitTestRotateHandle(scenePt: Point, piece: Piece): boolean {
  const { x: handleX, y: handleY } = getRotateHandlePos(piece);
  const hr = ROTATE_HANDLE_RADIUS / sceneXform.zoom;
  const threshold = hr + 5 / sceneXform.zoom;
  const dx = scenePt.x - handleX;
  const dy = scenePt.y - handleY;
  return dx * dx + dy * dy < threshold * threshold;
}

function getPlacedPieceAt(scenePt: Point): Piece | null {
  if (!puzzle) return null;
  for (let i = puzzle.pieces.length - 1; i >= 0; i--) {
    const piece = puzzle.pieces[i];
    if (!piece.isPlaced) continue;
    const localPt = transform.applyToPoint(transform.inverse(piece.transform), scenePt);
    if (polygon.containsPoint(piece.polygon, localPt)) {
      return piece;
    }
  }
  return null;
}

function getRotateHandlePieceAt(scenePt: Point): Piece | null {
  if (!puzzle) return null;
  for (let i = puzzle.pieces.length - 1; i >= 0; i--) {
    const piece = puzzle.pieces[i];
    if (!piece.isPlaced) continue;
    if (hitTestRotateHandle(scenePt, piece)) {
      return piece;
    }
  }
  return null;
}

function selectPiecesInMarquee(marquee: MarqueeInfo): void {
  if (!puzzle) return;
  const minX = Math.min(marquee.start.x, marquee.current.x);
  const minY = Math.min(marquee.start.y, marquee.current.y);
  const maxX = Math.max(marquee.start.x, marquee.current.x);
  const maxY = Math.max(marquee.start.y, marquee.current.y);

  const nextSelection = new Set<number>();
  for (const piece of puzzle.pieces) {
    if (!piece.isPlaced) continue;
    const worldPoly = transform.applyToPolygon(piece.transform, piece.polygon);
    const centroid = polygon.centroid(worldPoly);
    if (
      centroid.x >= minX && centroid.x <= maxX
      && centroid.y >= minY && centroid.y <= maxY
    ) {
      nextSelection.add(piece.id);
    }
  }
  selectedPieceIds = nextSelection;
}

function createFrameSnapPieces(frameTilePolygons: Polygon[]): Piece[] {
  return frameTilePolygons.map((poly, index) => {
    const sides = polygon.edges(poly).map((edge) => ({
      id: 0,
      ptA: { x: edge.to.x, y: edge.to.y },
      ptB: { x: edge.from.x, y: edge.from.y },
      attachable: false,
    }));

    return {
      id: -100000 - index,
      polygon: poly,
      transform: transform.identity(),
      sides,
      isPlaced: true,
      isFramePiece: true,
    };
  });
}

function renderSingleThumbnail(thumbCanvas: HTMLCanvasElement, piece: Piece): void {
  const tctx = thumbCanvas.getContext('2d');
  if (!tctx) return;
  const size = THUMBNAIL_SIZE;
  tctx.clearRect(0, 0, size, size);

  const localCentroid = polygon.centroid(piece.polygon);
  const poly = transform.applyToPolygon(
    transform.compose(
      transform.rotation(canonicalPieceRotation(piece)),
      transform.translation(-localCentroid.x, -localCentroid.y),
    ),
    piece.polygon,
  );
  const verts = poly.vertices;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  const pw = maxX - minX;
  const ph = maxY - minY;
  if (pw <= 0 || ph <= 0) return;
  const s = Math.min((size - 8) / pw, (size - 8) / ph);
  const ox = (size - pw * s) / 2 - minX * s;
  const oy = (size - ph * s) / 2 - minY * s;

  tctx.save();
  tctx.translate(ox, oy);
  tctx.scale(s, s);
  const path = buildPiecePath(poly);
  const colors = pieceColor(piece.id, piece.polygon);
  tctx.fillStyle = colors.fill;
  tctx.fill(path);
  tctx.strokeStyle = colors.stroke;
  tctx.lineWidth = 1.5 / s;
  tctx.stroke(path);
  tctx.restore();
}

function updateTray(): void {
  const tray = document.getElementById('piece-tray');
  if (!tray) return;
  tray.innerHTML = '';
  if (!puzzle) return;

  const unplaced = puzzle.pieces.filter((p) => !p.isPlaced);
  const countEl = document.getElementById('tray-count');
  if (countEl) countEl.textContent = String(unplaced.length);

  if (unplaced.length === 0) return;

  const groups: Array<{ kind: TrayPieceKind; pieces: Piece[]; label: string }> = [
    {
      kind: 'normal',
      pieces: unplaced.filter((p) => pieceKind(p.polygon) === 'normal'),
      label: 'Normal',
    },
    {
      kind: 'chiral',
      pieces: unplaced.filter((p) => pieceKind(p.polygon) === 'chiral'),
      label: 'Chiral',
    },
  ];

  for (const group of groups) {
    const piece = group.pieces[0];
    if (!piece) continue;

    const card = document.createElement('div');
    card.className = 'tray-piece';
    card.dataset.pieceKind = group.kind;
    card.style.cursor = 'grab';
    card.draggable = true;

    if (selectedTrayPieceKind === group.kind) {
      card.classList.add('selected');
    }

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = THUMBNAIL_SIZE;
    thumbCanvas.height = THUMBNAIL_SIZE;
    renderSingleThumbnail(thumbCanvas, piece);

    const label = document.createElement('span');
    label.className = 'tray-label';
    label.textContent = `${group.label} x${group.pieces.length}`;

    card.appendChild(thumbCanvas);
    card.appendChild(label);

    card.addEventListener('click', () => {
      selectedTrayPieceKind = selectedTrayPieceKind === group.kind ? null : group.kind;
      updateTraySelection();
    });

    card.addEventListener('dragstart', (e) => {
      selectedTrayPieceKind = group.kind;
      e.dataTransfer?.setData('text/plain', `puzzle-piece-kind:${group.kind}`);
      e.dataTransfer?.setData('application/x-puzzle-piece-kind', group.kind);
      updateTraySelection();
    });

    tray.appendChild(card);
  }
}

function updateTraySelection(): void {
  const tray = document.getElementById('piece-tray');
  if (!tray) return;
  const cards = tray.querySelectorAll('.tray-piece');
  cards.forEach((c) => {
    const kind = (c as HTMLElement).dataset.pieceKind;
    c.classList.toggle('selected', kind === selectedTrayPieceKind);
  });
}

function updateStatusBar(): void {
  if (!puzzle) return;
  const total = puzzle.pieces.length;
  const placed = puzzle.pieces.filter((p) => p.isPlaced).length;
  const el = document.getElementById('status-pieces');
  if (el) el.textContent = `Pieces: ${placed} / ${total}`;
}

function renderPuzzleList(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  const container = document.getElementById('puzzle-list');
  const countEl = document.getElementById('puzzle-list-count');
  if (!container) return;

  container.innerHTML = '';
  const puzzles = listSavedPuzzles();
  if (countEl) countEl.textContent = String(puzzles.length);

  if (puzzles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'puzzle-list-empty';
    empty.textContent = 'No saved puzzles. Create one first!';
    container.appendChild(empty);
    return;
  }

  for (const meta of puzzles.slice().reverse()) {
    const item = document.createElement('div');
    item.className = 'puzzle-list-item';

    const info = document.createElement('div');
    info.className = 'puzzle-list-info';

    const name = document.createElement('span');
    name.className = 'puzzle-list-name';
    name.textContent = meta.name;

    const detail = document.createElement('span');
    detail.className = 'puzzle-list-detail';
    detail.textContent = `${meta.pieceCount} pcs · ${meta.tileType}`;

    info.appendChild(name);
    info.appendChild(detail);

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-sm';
    loadBtn.textContent = 'Play';
    loadBtn.addEventListener('click', () => {
      try {
        const loaded = loadSavedPuzzle(meta.id);
        if (!loaded) {
          window.alert('Failed to load puzzle — data may be corrupted. Check console for details.');
          return;
        }
        const json = exportPuzzleRaw(meta.id);
        if (!json) {
          window.alert('Failed to export puzzle data.');
          return;
        }
        loadPuzzleFromModel(loaded, json, ctx, canvas);
      } catch (e) {
        console.error('[Play] Unexpected error:', e);
        window.alert('Error loading puzzle: ' + (e instanceof Error ? e.message : String(e)));
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      deleteSavedPuzzle(meta.id);
      renderPuzzleList(ctx, canvas);
    });

    item.appendChild(info);
    item.appendChild(loadBtn);
    item.appendChild(delBtn);
    container.appendChild(item);
  }
}

function exportPuzzleRaw(id: string): string | null {
  try {
    const raw = localStorage.getItem('spectre-puzzle-saved');
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    const entry = arr.find((e: { id: string }) => e.id === id);
    return entry ? (entry as { json: string }).json : null;
  } catch {
    return null;
  }
}

function extractCurveMeta(json: string): void {
  try {
    const parsed = JSON.parse(json);
    curvedEdges = parsed['curvedEdges'] === true;
    curveData = parsed['curveData'] || null;
  } catch {
    curvedEdges = false;
    curveData = null;
  }
}

function loadPuzzleFromModel(
  loaded: PuzzleModel,
  json: string,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  puzzle = loaded;
  initialJSON = json;
  won = false;
  selectedTrayPieceKind = null;
  dragInfo = null;
  rotateDragInfo = null;
  marqueeInfo = null;
  selectedPieceIds.clear();
  hoveredPieceId = null;

  extractCurveMeta(json);

  buildColorMap();
  removeVictoryOverlay();
  resizeCanvas(canvas);
  centerView(canvas);
  updateTray();
  updateStatusBar();
  render(ctx, canvas);
}

function handleImport(
  fileInput: HTMLInputElement,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  const file = fileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== 'string') return;
    try {
      const text = reader.result;
      puzzle = importPuzzle(text);
      initialJSON = text;
      won = false;
      selectedTrayPieceKind = null;
      dragInfo = null;
      rotateDragInfo = null;
      marqueeInfo = null;
      selectedPieceIds.clear();
      hoveredPieceId = null;

      extractCurveMeta(text);

      buildColorMap();
      removeVictoryOverlay();
      resizeCanvas(canvas);
      centerView(canvas);
      updateTray();
      updateStatusBar();
      render(ctx, canvas);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load puzzle';
      alert(msg);
    }
  };
  reader.readAsText(file);
  fileInput.value = '';
}

function placePiecesFromTray(
  scenePt: Point,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  kind: TrayPieceKind | null = selectedTrayPieceKind,
): void {
  if (!puzzle) return;
  const piece = puzzle.pieces.find((p) => !p.isPlaced && pieceKind(p.polygon) === kind);
  if (!piece) return;

  const localCentroid = polygon.centroid(piece.polygon);
  piece.transform = transformFromCentroid(scenePt, localCentroid, canonicalPieceRotation(piece));
  piece.isPlaced = true;

  selectedTrayPieceKind = null;
  updateTray();
  updateStatusBar();
  trySnap(piece, ctx, canvas);
}

function trySnap(
  piece: Piece,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  if (!puzzle) return;
  const snapModel: PuzzleModel = {
    ...puzzle,
    pieces: [
      ...puzzle.pieces.filter((p) => p.id === piece.id || p.isPlaced),
      ...createFrameSnapPieces(puzzle.frameTilePolygons),
    ],
  };
  const snap = findSnapTarget(
    piece,
    snapModel,
    SOLVE_SNAP_THRESHOLD,
    SOLVE_SNAP_ANGLE_THRESHOLD,
    SOLVE_SNAP_GEOMETRIC_MATCH,
    SOLVE_SNAP_INCLUDE_BOUNDARY_EDGES,
  );
  if (!snap) return;

  const finalTransform = snap.adjustedTransform ?? transform.compose(
    transform.translation(-snap.offset.x, -snap.offset.y),
    piece.transform,
  );

  piece.transform = finalTransform;
  updateTray();
  updateStatusBar();
  checkWinAndRender();
  render(ctx, canvas);
}

function rotatePieceBy(piece: Piece, angleDelta: number): void {
  const localCentroid = polygon.centroid(piece.polygon);
  const currentRot = extractRotation(piece.transform);
  const newRot = currentRot + angleDelta;
  const worldCentroid = transform.applyToPoint(piece.transform, localCentroid);

  piece.transform = transformFromCentroid(worldCentroid, localCentroid, newRot);
}

function checkWinAndRender(): void {
  if (!puzzle || won) return;
  const result = checkWinCondition(puzzle);
  if (result.isComplete) {
    won = true;
    showVictoryOverlay();
  }
}

function showVictoryOverlay(): void {
  removeVictoryOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'victory-overlay';
  overlay.id = 'victory-overlay';

  const card = document.createElement('div');
  card.className = 'victory-card';

  const h2 = document.createElement('h2');
  h2.textContent = 'Puzzle Complete!';

  const p = document.createElement('p');
  p.textContent = 'Congratulations! You solved the puzzle.';

  const actions = document.createElement('div');
  actions.className = 'victory-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save Image';
  saveBtn.addEventListener('click', () => {
    const mainCanvas = document.getElementById('main-canvas') as HTMLCanvasElement;
    saveImage(mainCanvas);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', removeVictoryOverlay);

  actions.appendChild(saveBtn);
  actions.appendChild(closeBtn);
  card.appendChild(h2);
  card.appendChild(p);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function removeVictoryOverlay(): void {
  const existing = document.getElementById('victory-overlay');
  if (existing) existing.remove();
}

function showSolution(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  if (!puzzle) return;

  anim.cancelAll();

  const revealer = new SolutionRevealer(puzzle.pieces, puzzle.solutionMap);
  const steps: Array<{ pieceId: number; xform: AffineTransform }> = [];
  for (;;) {
    const step = revealer.step();
    if (step.done) break;
    steps.push({ pieceId: step.pieceId, xform: step.transform });
  }

  const pieceIds: number[] = [];
  const currentPositions: Point[] = [];
  const solutionPositions: Point[] = [];

  for (const s of steps) {
    const piece = puzzle.pieces.find((p) => p.id === s.pieceId);
    if (!piece) continue;

    const currentWorldCentroid = polygon.centroid(
      transform.applyToPolygon(piece.transform, piece.polygon),
    );
    const solutionWorldCentroid = polygon.centroid(
      transform.applyToPolygon(s.xform, piece.polygon),
    );

    pieceIds.push(s.pieceId);
    currentPositions.push(currentWorldCentroid);
    solutionPositions.push(solutionWorldCentroid);
  }

  anim.animateSolutionReveal(
    pieceIds,
    currentPositions,
    solutionPositions,
    100,
    300,
    undefined,
    (pieceId, pos) => {
      const piece = puzzle?.pieces.find((p) => p.id === pieceId);
      if (!piece) return;
      const localCentroid = polygon.centroid(piece.polygon);
      piece.transform = transformFromCentroid(pos, localCentroid, 0);
      piece.isPlaced = true;
      render(ctx, canvas);
    },
  );

  updateTray();
  updateStatusBar();
  checkWinAndRender();
}

function doReset(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (!initialJSON) return;
  anim.cancelAll();
  puzzle = importPuzzle(initialJSON);
  won = false;
  selectedTrayPieceKind = null;
  dragInfo = null;
  rotateDragInfo = null;
  marqueeInfo = null;
  selectedPieceIds.clear();
  hoveredPieceId = null;
  removeVictoryOverlay();

  extractCurveMeta(initialJSON);

  buildColorMap();
  updateTray();
  updateStatusBar();
  render(ctx, canvas);
}

function saveImage(canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'spectre-puzzle-solved.png';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function onPointerDown(
  e: PointerEvent,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  if (!puzzle) return;

  if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
    e.preventDefault();
    return;
  }

  if (e.button !== 0) return;

  const scenePt = toScene(e, canvas);

  if (rotateDragInfo !== null) {
    rotateDragInfo = null;
  }
  marqueeInfo = null;

  const rotatePiece = getRotateHandlePieceAt(scenePt);
  if (rotatePiece) {
    const { pivotX, pivotY } = getRotateHandlePos(rotatePiece);
    rotateDragInfo = {
      pieceId: rotatePiece.id,
      startAngle: Math.atan2(scenePt.y - pivotY, scenePt.x - pivotX),
      startRotation: extractRotation(rotatePiece.transform),
      pivotX,
      pivotY,
    };
    hoveredPieceId = rotatePiece.id;
    canvas.setPointerCapture(e.pointerId);
    render(ctx, canvas);
    return;
  }

  const hitPiece = getPlacedPieceAt(scenePt);
  if (hitPiece) {
    const groupIds = selectedPieceIds.has(hitPiece.id)
      ? Array.from(selectedPieceIds)
      : [];
    if (groupIds.length <= 1) {
      selectedPieceIds.clear();
    }

    const localCentroid = polygon.centroid(hitPiece.polygon);
    const worldCentroid = transform.applyToPoint(
      hitPiece.transform,
      localCentroid,
    );
    dragInfo = {
      pieceId: hitPiece.id,
      anchorOffset: point.subtract(scenePt, worldCentroid),
      startRotation: extractRotation(hitPiece.transform),
      groupIds,
      startScenePt: scenePt,
      startTransforms: new Map(
        groupIds
          .map((id): [number, AffineTransform] | null => {
            const piece = puzzle?.pieces.find((p) => p.id === id && p.isPlaced);
            return piece ? [id, piece.transform] : null;
          })
          .filter((entry): entry is [number, AffineTransform] => entry !== null),
      ),
    };
    canvas.setPointerCapture(e.pointerId);
    render(ctx, canvas);
    return;
  }

  selectedPieceIds.clear();
  marqueeInfo = { start: scenePt, current: scenePt };
  canvas.setPointerCapture(e.pointerId);
  render(ctx, canvas);
}

function onPointerMove(
  e: PointerEvent,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  if (!puzzle) return;
  const scenePt = toScene(e, canvas);

  const rdInfo = rotateDragInfo;
  if (rdInfo !== null) {
    const piece = puzzle.pieces.find((p) => p.id === rdInfo.pieceId);
    if (piece) {
      const currentAngle = Math.atan2(scenePt.y - rdInfo.pivotY, scenePt.x - rdInfo.pivotX);
      const angleDelta = currentAngle - rdInfo.startAngle;
      const newRot = rdInfo.startRotation + angleDelta;
      const localCentroid = polygon.centroid(piece.polygon);
      piece.transform = transformFromCentroid(
        { x: rdInfo.pivotX, y: rdInfo.pivotY },
        localCentroid,
        newRot,
      );
      render(ctx, canvas);
    }
    return;
  }

  const drag = dragInfo;
  if (drag) {
    if (drag.groupIds.length > 1) {
      const delta = point.subtract(scenePt, drag.startScenePt);
      for (const id of drag.groupIds) {
        const piece = puzzle.pieces.find((p) => p.id === id);
        const startTransform = drag.startTransforms.get(id);
        if (!piece || !startTransform) continue;
        piece.transform = transform.compose(
          transform.translation(delta.x, delta.y),
          startTransform,
        );
      }
      render(ctx, canvas);
      return;
    }

    const piece = puzzle.pieces.find((p) => p.id === drag.pieceId);
    if (!piece) return;

    const newWorldCentroid = point.subtract(scenePt, drag.anchorOffset);
    const localCentroid = polygon.centroid(piece.polygon);
    const rot = drag.startRotation;
    piece.transform = transformFromCentroid(newWorldCentroid, localCentroid, rot);
    render(ctx, canvas);
    return;
  }

  if (marqueeInfo !== null) {
    marqueeInfo.current = scenePt;
    render(ctx, canvas);
    return;
  }

  const oldHovered = hoveredPieceId;
  const hitPiece = getPlacedPieceAt(scenePt);
  hoveredPieceId = hitPiece ? hitPiece.id : null;

  if (hoveredPieceId !== oldHovered) {
    render(ctx, canvas);
  }
}

function extractRotation(xform: AffineTransform): number {
  const m = xform.matrix;
  return Math.atan2(m[3], m[0]);
}

function onPointerUp(
  e: PointerEvent,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  if (rotateDragInfo !== null) {
    rotateDragInfo = null;
    render(ctx, canvas);
    return;
  }

  if (marqueeInfo !== null) {
    selectPiecesInMarquee(marqueeInfo);
    marqueeInfo = null;
    render(ctx, canvas);
    return;
  }

  const drag = dragInfo;
  if (!drag || !puzzle) return;
  const piece = puzzle.pieces.find((p) => p.id === drag.pieceId);
  dragInfo = null;

  if (piece && drag.groupIds.length <= 1) {
    trySnap(piece, ctx, canvas);
  }
  render(ctx, canvas);
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const renderCtx: CanvasRenderingContext2D = ctx;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;

  resizeCanvas(canvas);
  renderPuzzleList(renderCtx, canvas);

  window.addEventListener('resize', () => {
    resizeCanvas(canvas);
    if (puzzle) centerView(canvas);
    render(renderCtx, canvas);
  });

  document
    .getElementById('btn-import')
    ?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleImport(fileInput, renderCtx, canvas));
  document
    .getElementById('btn-solution')
    ?.addEventListener('click', () => showSolution(renderCtx, canvas));
  document
    .getElementById('btn-save')
    ?.addEventListener('click', () => saveImage(canvas));
  document
    .getElementById('btn-reset')
    ?.addEventListener('click', () => doReset(renderCtx, canvas));

  canvas.addEventListener('pointerdown', (e) => onPointerDown(e, canvas, renderCtx));
  canvas.addEventListener('pointermove', (e) => onPointerMove(e, canvas, renderCtx));
  canvas.addEventListener('pointerup', (e) => onPointerUp(e, canvas, renderCtx));
  canvas.addEventListener('pointerleave', () => {
    if (hoveredPieceId !== null) {
      hoveredPieceId = null;
      render(renderCtx, canvas);
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const data = e.dataTransfer?.getData('text/plain');
    const rawKind = e.dataTransfer?.getData('application/x-puzzle-piece-kind')
      || data?.replace(/^puzzle-piece-kind:/, '')
      || '';
    if (rawKind === 'normal' || rawKind === 'chiral') {
      const scenePt = toScene(e as unknown as PointerEvent, canvas);
      placePiecesFromTray(scenePt, renderCtx, canvas, rawKind);
      render(renderCtx, canvas);
    }
  });

  render(renderCtx, canvas);
});
