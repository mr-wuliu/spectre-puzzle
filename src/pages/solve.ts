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
  sceneToScreen,
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
  startSelectionFrame: SelectionFrame | null;
}

interface RotateDragInfo {
  startAngle: number;
  pivotX: number;
  pivotY: number;
  groupIds: number[];
  startTransforms: Map<number, AffineTransform>;
  startSelectionFrame: SelectionFrame;
}

interface MarqueeInfo {
  start: Point;
  current: Point;
}

interface SelectionFrame {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
}

type TrayPieceKind = 'normal' | 'chiral';

const THUMBNAIL_SIZE = 72;
const ROTATE_HANDLE_RADIUS = 12;
const ROTATE_HANDLE_OFFSET = 28;
const TRASH_ZONE_SIZE = 64;
const TRASH_ZONE_MARGIN = 16;
const SOLVE_SNAP_THRESHOLD = 0.2;
const SOLVE_SNAP_ANGLE_THRESHOLD = Math.PI / 18;
const SOLVE_SNAP_GEOMETRIC_MATCH = true;
const SOLVE_SNAP_INCLUDE_BOUNDARY_EDGES = true;
const VIEW_MIN_FRAME_SCALE = 0.45;
const VIEW_MAX_FRAME_SCALE = 4.5;
const VIEW_OVERSCROLL_FACTOR = 0.28;
const VIEW_REBOUND_MS = 180;

let puzzle: PuzzleModel | null = null;
let initialJSON = '';
let sceneXform: SceneTransform = createSceneTransform();
let dragInfo: DragInfo | null = null;
let rotateDragInfo: RotateDragInfo | null = null;
let marqueeInfo: MarqueeInfo | null = null;
let selectedPieceIds = new Set<number>();
let selectionFrame: SelectionFrame | null = null;
let selectedTrayPieceKind: TrayPieceKind | null = null;
let won = false;
let hoveredPieceId: number | null = null;
let pieceColorMap = new Map<number, { fill: string; stroke: string }>();
let curvedEdges = false;
let curveData: EdgeCurveData | null = null;
let trashDropActive = false;
let panMode = false;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let gameStarted = false;
let initialXform: SceneTransform | null = null;
let timerStartMs = 0;
let elapsedMs = 0;
let timerFrozen = false;
let timerIntervalId: number | null = null;
let viewReboundFrameId: number | null = null;
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
  updateTimerPosition();
}

function canvasLogicalSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  return { w: canvas.width / dpr, h: canvas.height / dpr };
}

function centerView(canvas: HTMLCanvasElement): void {
  if (!puzzle) return;
  cancelViewRebound();
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
  initialXform = sceneXform;
  updateTimerPosition();
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

  drawFixedFrame(ctx);

  ctx.save();
  clipToFixedFrame(ctx);
  applyToCtx(ctx, sceneXform);
  drawFrameInterior(ctx, puzzle.frameTilePolygons);

  const placed = puzzle.pieces.filter((p) => p.isPlaced);
  for (const p of placed) {
    const isDragging = dragInfo !== null && dragInfo.pieceId === p.id;
    drawPiece(ctx, p, isDragging || selectedPieceIds.has(p.id));
  }

  drawSelectionFrame(ctx);

  if (marqueeInfo !== null) {
    drawMarquee(ctx, marqueeInfo);
  }

  ctx.restore();

  drawStartOverlay(ctx, canvas);
  drawPanTool(ctx, canvas);
  drawTrashDropZone(ctx, canvas);
  ctx.restore();
}

function fixedFrameTransform(): SceneTransform {
  return initialXform ?? sceneXform;
}

function frameWorldSize(): { width: number; height: number } | null {
  if (!puzzle) return null;
  const bbox = polygon.boundingBox(puzzle.framePolygon);
  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function viewZoomLimits(): { min: number; max: number } {
  const fixedBounds = frameScreenBoundsForXform(fixedFrameTransform());
  const worldSize = frameWorldSize();
  if (!fixedBounds || !worldSize) return { min: 0.05, max: 100 };

  const fixedWidth = fixedBounds.maxX - fixedBounds.minX;
  const fixedHeight = fixedBounds.maxY - fixedBounds.minY;
  const minZoom = Math.max(
    (fixedWidth * VIEW_MIN_FRAME_SCALE) / worldSize.width,
    (fixedHeight * VIEW_MIN_FRAME_SCALE) / worldSize.height,
  );
  const maxZoom = Math.min(
    (fixedWidth * VIEW_MAX_FRAME_SCALE) / worldSize.width,
    (fixedHeight * VIEW_MAX_FRAME_SCALE) / worldSize.height,
  );

  return {
    min: Math.max(0.001, Math.min(minZoom, maxZoom)),
    max: Math.max(minZoom, maxZoom),
  };
}

function clampZoom(zoom: number): number {
  const limits = viewZoomLimits();
  return Math.max(limits.min, Math.min(limits.max, zoom));
}

function clampViewTransform(candidate: SceneTransform): SceneTransform {
  if (!puzzle) return candidate;
  const fixedBounds = frameScreenBoundsForXform(fixedFrameTransform());
  if (!fixedBounds) return candidate;

  let next = { ...candidate, zoom: clampZoom(candidate.zoom) };
  const contentBounds = frameScreenBoundsForXform(next);
  if (!contentBounds) return next;

  const fixedWidth = fixedBounds.maxX - fixedBounds.minX;
  const fixedHeight = fixedBounds.maxY - fixedBounds.minY;
  const contentWidth = contentBounds.maxX - contentBounds.minX;
  const contentHeight = contentBounds.maxY - contentBounds.minY;
  const fixedCenterX = (fixedBounds.minX + fixedBounds.maxX) / 2;
  const fixedCenterY = (fixedBounds.minY + fixedBounds.maxY) / 2;
  const contentCenterX = (contentBounds.minX + contentBounds.maxX) / 2;
  const contentCenterY = (contentBounds.minY + contentBounds.maxY) / 2;

  let dx = 0;
  if (contentWidth <= fixedWidth) {
    dx = fixedCenterX - contentCenterX;
  } else if (contentBounds.minX > fixedBounds.minX) {
    dx = fixedBounds.minX - contentBounds.minX;
  } else if (contentBounds.maxX < fixedBounds.maxX) {
    dx = fixedBounds.maxX - contentBounds.maxX;
  }

  let dy = 0;
  if (contentHeight <= fixedHeight) {
    dy = fixedCenterY - contentCenterY;
  } else if (contentBounds.minY > fixedBounds.minY) {
    dy = fixedBounds.minY - contentBounds.minY;
  } else if (contentBounds.maxY < fixedBounds.maxY) {
    dy = fixedBounds.maxY - contentBounds.maxY;
  }

  next = { ...next, panX: next.panX + dx, panY: next.panY + dy };
  return next;
}

function rubberBandOverflow(overflow: number, referenceSize: number): number {
  if (Math.abs(overflow) < 1e-6) return 0;
  const size = Math.max(1, referenceSize);
  return (overflow * VIEW_OVERSCROLL_FACTOR) / (1 + Math.abs(overflow) / size);
}

function elasticViewTransform(candidate: SceneTransform): SceneTransform {
  const clamped = clampViewTransform(candidate);
  const fixedBounds = frameScreenBoundsForXform(fixedFrameTransform());
  if (!fixedBounds) return clamped;

  const fixedWidth = fixedBounds.maxX - fixedBounds.minX;
  const fixedHeight = fixedBounds.maxY - fixedBounds.minY;
  return {
    ...clamped,
    panX: clamped.panX + rubberBandOverflow(candidate.panX - clamped.panX, fixedWidth),
    panY: clamped.panY + rubberBandOverflow(candidate.panY - clamped.panY, fixedHeight),
  };
}

function cancelViewRebound(): void {
  if (viewReboundFrameId === null) return;
  window.cancelAnimationFrame(viewReboundFrameId);
  viewReboundFrameId = null;
}

function easeOutCubicLocal(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function animateViewTo(
  target: SceneTransform,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  cancelViewRebound();
  const start = sceneXform;
  const targetXform = clampViewTransform(target);
  const startTime = performance.now();

  function tick(now: number): void {
    const t = Math.min(1, (now - startTime) / VIEW_REBOUND_MS);
    const eased = easeOutCubicLocal(t);
    sceneXform = {
      ...start,
      panX: start.panX + (targetXform.panX - start.panX) * eased,
      panY: start.panY + (targetXform.panY - start.panY) * eased,
      zoom: start.zoom + (targetXform.zoom - start.zoom) * eased,
    };
    updateTimerPosition();
    render(ctx, canvas);

    if (t < 1) {
      viewReboundFrameId = window.requestAnimationFrame(tick);
    } else {
      viewReboundFrameId = null;
      sceneXform = targetXform;
      updateTimerPosition();
      render(ctx, canvas);
    }
  }

  viewReboundFrameId = window.requestAnimationFrame(tick);
}

function reboundViewIntoBounds(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const target = clampViewTransform(sceneXform);
  if (
    Math.abs(target.panX - sceneXform.panX) < 0.5
    && Math.abs(target.panY - sceneXform.panY) < 0.5
    && Math.abs(target.zoom - sceneXform.zoom) < 1e-4
  ) {
    sceneXform = target;
    updateTimerPosition();
    render(ctx, canvas);
    return;
  }
  animateViewTo(target, ctx, canvas);
}

function drawFixedFrame(ctx: CanvasRenderingContext2D): void {
  if (!puzzle) return;
  const frame = puzzle.framePolygon;
  const verts = frame.vertices;
  if (verts.length < 3) return;

  const xform = fixedFrameTransform();
  ctx.save();
  applyToCtx(ctx, xform);

  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(232, 220, 200, 0.3)';
  ctx.fill();

  ctx.strokeStyle = '#3f3320';
  ctx.lineWidth = 4 / xform.zoom;
  ctx.setLineDash([8 / xform.zoom, 4 / xform.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

function clipToFixedFrame(ctx: CanvasRenderingContext2D): void {
  if (!puzzle) return;
  const pts = frameScreenPoints(fixedFrameTransform());
  if (pts.length < 3) return;

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();
}

function drawFrameInterior(
  ctx: CanvasRenderingContext2D,
  frameTilePolys: Polygon[],
): void {
  if (!gameStarted || frameTilePolys.length === 0) return;

  ctx.save();
  ctx.fillStyle = 'rgba(232, 220, 200, 0.12)';
  for (const ftp of frameTilePolys) {
    ctx.fill(buildPiecePath(ftp));
  }

  if (curvedEdges) {
    drawFrameTileBoundary(ctx, frameTilePolys);
  } else {
    drawBoundaryLoops(ctx, buildBoundaryLoops(frameTilePolys));
  }
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

    const boundaryLoops = gameStarted && !curvedEdges ? buildBoundaryLoops(frameTilePolys) : [];
    if (boundaryLoops.length > 0) {
      for (const loop of boundaryLoops) {
        addLoopToPath(path, loop);
      }
    } else if (gameStarted) {
      for (const ftp of frameTilePolys) {
        const tilePath = buildPiecePath(ftp);
        path.addPath(tilePath);
      }
    }

    ctx.fillStyle = 'rgba(232, 220, 200, 0.3)';
    ctx.fill(path, 'evenodd');

    if (gameStarted && curvedEdges) {
      drawFrameTileBoundary(ctx, frameTilePolys);
    } else if (boundaryLoops.length > 0) {
      drawBoundaryLoops(ctx, boundaryLoops);
    }

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

function buildBoundaryLoops(frameTilePolys: Polygon[]): Point[][] {
  const edges: Array<{ a: Point; b: Point }> = [];

  for (const poly of frameTilePolys) {
    const verts = poly.vertices;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      if (point.distance(a, b) < 1e-8) continue;
      edges.push({ a, b });
    }
  }

  const boundaryEdges = buildUnionBoundaryEdges(edges);
  const loops: Point[][] = [];
  const used = new Set<number>();
  const eps = 1e-4;

  while (used.size < boundaryEdges.length) {
    const startIdx = boundaryEdges.findIndex((_, i) => !used.has(i));
    if (startIdx === -1) break;

    const loop: Point[] = [boundaryEdges[startIdx].a];
    used.add(startIdx);
    let currentEnd = boundaryEdges[startIdx].b;

    for (;;) {
      let foundNext = false;
      for (let i = 0; i < boundaryEdges.length; i++) {
        if (used.has(i)) continue;
        const edge = boundaryEdges[i];
        if (point.distance(edge.a, currentEnd) < eps) {
          loop.push(edge.a);
          currentEnd = edge.b;
          used.add(i);
          foundNext = true;
          break;
        }
        if (point.distance(edge.b, currentEnd) < eps) {
          loop.push(edge.b);
          currentEnd = edge.a;
          used.add(i);
          foundNext = true;
          break;
        }
      }

      if (!foundNext || point.distance(currentEnd, loop[0]) < eps) break;
    }

    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

function buildUnionBoundaryEdges(edges: Array<{ a: Point; b: Point }>): Array<{ a: Point; b: Point }> {
  type ProjectedSegment = { t1: number; t2: number; sign: number };
  type LineGroup = {
    ux: number;
    uy: number;
    nx: number;
    ny: number;
    offset: number;
    segments: ProjectedSegment[];
  };

  const groups = new Map<string, LineGroup>();
  const scale = 1000;

  for (const edge of edges) {
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-8) continue;

    let ux = dx / len;
    let uy = dy / len;
    if (ux < -1e-8 || (Math.abs(ux) < 1e-8 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }

    const nx = -uy;
    const ny = ux;
    const offset = edge.a.x * nx + edge.a.y * ny;
    const key = `${Math.round(ux * scale)},${Math.round(uy * scale)},${Math.round(offset * scale)}`;

    let group = groups.get(key);
    if (!group) {
      group = { ux, uy, nx, ny, offset, segments: [] };
      groups.set(key, group);
    }

    const ta = edge.a.x * group.ux + edge.a.y * group.uy;
    const tb = edge.b.x * group.ux + edge.b.y * group.uy;
    group.segments.push({
      t1: Math.min(ta, tb),
      t2: Math.max(ta, tb),
      sign: ta <= tb ? 1 : -1,
    });
  }

  const boundaryEdges: Array<{ a: Point; b: Point }> = [];
  const eps = 1e-6;

  for (const group of groups.values()) {
    const cuts = Array.from(new Set(
      group.segments
        .flatMap((segment) => [segment.t1, segment.t2])
        .map((t) => Math.round(t / eps) * eps),
    )).sort((a, b) => a - b);

    for (let i = 0; i < cuts.length - 1; i++) {
      const t1 = cuts[i];
      const t2 = cuts[i + 1];
      if (t2 - t1 < eps) continue;
      const mid = (t1 + t2) / 2;
      const covering = group.segments.filter((segment) =>
        mid > segment.t1 + eps && mid < segment.t2 - eps
      );
      if (covering.length !== 1) continue;

      const start = {
        x: group.ux * t1 + group.nx * group.offset,
        y: group.uy * t1 + group.ny * group.offset,
      };
      const end = {
        x: group.ux * t2 + group.nx * group.offset,
        y: group.uy * t2 + group.ny * group.offset,
      };
      boundaryEdges.push(covering[0].sign > 0 ? { a: start, b: end } : { a: end, b: start });
    }
  }

  return boundaryEdges;
}

function addLoopToPath(path: Path2D, loop: Point[]): void {
  path.moveTo(loop[0].x, loop[0].y);
  for (let i = 1; i < loop.length; i++) {
    path.lineTo(loop[i].x, loop[i].y);
  }
  path.closePath();
}

function drawBoundaryLoops(ctx: CanvasRenderingContext2D, loops: Point[][]): void {
  ctx.save();
  ctx.beginPath();
  for (const loop of loops) {
    if (loop.length < 3) continue;
    ctx.moveTo(loop[0].x, loop[0].y);
    for (let i = 1; i < loop.length; i++) {
      ctx.lineTo(loop[i].x, loop[i].y);
    }
    ctx.closePath();
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
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = point.distance(a, b);
  return `${Math.round(mx * 1000)},${Math.round(my * 1000)},${Math.round(len * 1000)}`;
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

function elapsedParts(ms: number): {
  hours: number;
  minutes: number;
  seconds: number;
  millis: number;
} {
  const totalMs = Math.max(0, Math.floor(ms));
  return {
    hours: Math.floor(totalMs / 3_600_000),
    minutes: Math.floor((totalMs % 3_600_000) / 60_000),
    seconds: Math.floor((totalMs % 60_000) / 1000),
    millis: totalMs % 1000,
  };
}

function formatElapsedFull(ms: number): string {
  const { hours, minutes, seconds, millis } = elapsedParts(ms);
  const msText = String(millis).padStart(3, '0');
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${msText}`;
}

function formatElapsedCompact(ms: number): string {
  const { hours, minutes, seconds, millis } = elapsedParts(ms);
  const msText = String(millis).padStart(3, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${msText}`;
  }
  if (minutes > 0) {
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${msText}`;
  }
  return `${String(seconds).padStart(2, '0')}.${msText}`;
}

function currentElapsedMs(): number {
  return gameStarted && !timerFrozen ? elapsedMs + performance.now() - timerStartMs : elapsedMs;
}

function ensureTimerElement(): HTMLDivElement {
  const existing = document.getElementById('solve-timer') as HTMLDivElement | null;
  if (existing) return existing;

  const timer = document.createElement('div');
  timer.id = 'solve-timer';
  timer.className = 'flip-clock-timer hidden';
  const canvasArea = document.getElementById('canvas-area');
  canvasArea?.appendChild(timer);
  return timer;
}

function updateTimerPosition(): void {
  const timer = ensureTimerElement();
  const xform = initialXform ?? sceneXform;
  const bounds = frameScreenBoundsForXform(xform);
  if (!puzzle || !bounds || (!gameStarted && elapsedMs === 0)) {
    timer.classList.add('hidden');
    return;
  }

  timer.classList.remove('hidden');
  timer.style.left = `${(bounds.minX + bounds.maxX) / 2}px`;
  timer.style.top = `${Math.max(4, bounds.minY / 2)}px`;
}

function setFlipUnit(unit: HTMLElement, value: string): void {
  const current = unit.dataset.value ?? '';
  if (current === value) return;

  unit.dataset.value = value;
  unit.querySelectorAll<HTMLElement>('.flip-card-current .flip-card-number').forEach((el) => {
    el.textContent = value;
  });

  if (current !== '') {
    unit.querySelectorAll<HTMLElement>('.flip-card-old .flip-card-number').forEach((el) => {
      el.textContent = current;
    });
    unit.querySelectorAll<HTMLElement>('.flip-card-next .flip-card-number').forEach((el) => {
      el.textContent = value;
    });
    unit.classList.remove('flipping');
    void unit.offsetWidth;
    unit.classList.add('flipping');
  }
}

function buildFlipDigit(value: string): HTMLSpanElement {
  const unit = document.createElement('span');
  unit.className = 'flip-card';
  unit.dataset.value = '';
  unit.innerHTML = `
    <span class="flip-card-half flip-card-top flip-card-current"><span class="flip-card-number"></span></span>
    <span class="flip-card-half flip-card-bottom flip-card-current"><span class="flip-card-number"></span></span>
    <span class="flip-card-half flip-card-flap flip-card-flap-top flip-card-old"><span class="flip-card-number"></span></span>
    <span class="flip-card-half flip-card-flap flip-card-flap-bottom flip-card-next"><span class="flip-card-number"></span></span>
  `;
  unit.addEventListener('animationend', () => unit.classList.remove('flipping'));
  setFlipUnit(unit, value);
  return unit;
}

function buildFlipSeparator(value: string): HTMLSpanElement {
  const sep = document.createElement('span');
  sep.className = `flip-clock-separator ${value === '.' ? 'dot' : 'colon'}`;
  sep.textContent = value;
  return sep;
}

function updateTimerDom(): void {
  const timer = ensureTimerElement();
  const text = formatElapsedFull(currentElapsedMs());

  if (timer.dataset.format !== text.replace(/\d/g, '0')) {
    timer.innerHTML = '';
    [...text].forEach((ch) => {
      timer.appendChild(/\d/.test(ch) ? buildFlipDigit(ch) : buildFlipSeparator(ch));
    });
    timer.dataset.format = text.replace(/\d/g, '0');
  } else {
    [...text].forEach((ch, index) => {
      if (!/\d/.test(ch)) return;
      const unit = timer.children[index] as HTMLElement | undefined;
      if (unit) setFlipUnit(unit, ch);
    });
  }

  updateTimerPosition();
}

function finishTimerAfterFlip(): void {
  if (gameStarted) {
    elapsedMs += performance.now() - timerStartMs;
  }
  timerFrozen = true;
  timerStartMs = 0;
  updateTimerDom();

  window.setTimeout(() => {
    updateTimerDom();
    gameStarted = false;
    timerFrozen = false;
    if (timerIntervalId !== null) {
      window.clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }, 430);
}

function frameScreenPoints(xform?: SceneTransform): Point[] {
  if (!puzzle) return [];
  return puzzle.framePolygon.vertices.map((v) =>
    sceneToScreen(xform ?? fixedFrameTransform(), v.x, v.y),
  );
}

function frameScreenBoundsForXform(xform: SceneTransform): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts = frameScreenPoints(xform);
  if (pts.length === 0) return null;
  return pts.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxX: Math.max(acc.maxX, p.x),
      maxY: Math.max(acc.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function frameScreenBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
  return frameScreenBoundsForXform(initialXform ?? sceneXform);
}

function getStartButtonHitCircle(): { x: number; y: number; r: number } | null {
  const bounds = frameScreenBounds();
  if (!bounds) return null;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    r: Math.max(34, Math.min(58, Math.min(w, h) * 0.13)),
  };
}

function drawStartOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (!puzzle || gameStarted || won) return;
  const pts = frameScreenPoints();
  const button = getStartButtonHitCircle();
  if (pts.length < 3 || !button) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();

  const { w, h } = canvasLogicalSize(canvas);
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = 'rgba(238, 229, 211, 0.78)';
  ctx.fillRect(0, 0, w, h);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  for (let y = 0; y < h; y += 8) {
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(139, 105, 20, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 4;
  ctx.stroke();

  const triW = button.r * 0.62;
  const triH = button.r * 0.78;
  ctx.beginPath();
  ctx.moveTo(button.x - triW * 0.32, button.y - triH / 2);
  ctx.lineTo(button.x - triW * 0.32, button.y + triH / 2);
  ctx.lineTo(button.x + triW * 0.48, button.y);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}

function getCanvasPoint(e: PointerEvent | DragEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function getTrashDropZoneRect(canvas: HTMLCanvasElement): {
  x: number;
  y: number;
  size: number;
} {
  const { w, h } = canvasLogicalSize(canvas);
  return {
    x: w - TRASH_ZONE_MARGIN - TRASH_ZONE_SIZE,
    y: h - TRASH_ZONE_MARGIN - TRASH_ZONE_SIZE,
    size: TRASH_ZONE_SIZE,
  };
}

function isInTrashDropZone(canvasPt: Point, canvas: HTMLCanvasElement): boolean {
  const rect = getTrashDropZoneRect(canvas);
  return (
    canvasPt.x >= rect.x
    && canvasPt.x <= rect.x + rect.size
    && canvasPt.y >= rect.y
    && canvasPt.y <= rect.y + rect.size
  );
}

function drawTrashDropZone(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (!gameStarted || won) return;
  const rect = getTrashDropZoneRect(canvas);
  const cx = rect.x + rect.size / 2;
  const cy = rect.y + rect.size / 2;
  const iconW = rect.size * 0.42;
  const iconH = rect.size * 0.44;
  const top = cy - iconH * 0.36;
  const left = cx - iconW / 2;

  ctx.save();
  ctx.fillStyle = trashDropActive
    ? 'rgba(155, 60, 45, 0.22)'
    : 'rgba(245, 238, 224, 0.72)';
  ctx.strokeStyle = trashDropActive
    ? 'rgba(155, 60, 45, 0.95)'
    : 'rgba(91, 63, 31, 0.62)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.size, rect.size, 6);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = trashDropActive ? '#8f2d22' : '#5b3f1f';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(left - iconW * 0.1, top);
  ctx.lineTo(left + iconW * 1.1, top);
  ctx.moveTo(left + iconW * 0.28, top - iconH * 0.18);
  ctx.lineTo(left + iconW * 0.72, top - iconH * 0.18);
  ctx.moveTo(left + iconW * 0.38, top - iconH * 0.18);
  ctx.lineTo(left + iconW * 0.44, top - iconH * 0.3);
  ctx.lineTo(left + iconW * 0.56, top - iconH * 0.3);
  ctx.lineTo(left + iconW * 0.62, top - iconH * 0.18);
  ctx.rect(left, top + iconH * 0.14, iconW, iconH * 0.72);
  ctx.moveTo(left + iconW * 0.33, top + iconH * 0.28);
  ctx.lineTo(left + iconW * 0.33, top + iconH * 0.72);
  ctx.moveTo(left + iconW * 0.67, top + iconH * 0.28);
  ctx.lineTo(left + iconW * 0.67, top + iconH * 0.72);
  ctx.stroke();
  ctx.restore();
}

function getPanToolRect(canvas: HTMLCanvasElement): {
  x: number;
  y: number;
  size: number;
} {
  const { w, h } = canvasLogicalSize(canvas);
  const size = TRASH_ZONE_SIZE;
  return {
    x: w - TRASH_ZONE_MARGIN - size,
    y: h - TRASH_ZONE_MARGIN - size * 2 - 8,
    size,
  };
}

function isInPanToolZone(canvasPt: Point, canvas: HTMLCanvasElement): boolean {
  const rect = getPanToolRect(canvas);
  return (
    canvasPt.x >= rect.x
    && canvasPt.x <= rect.x + rect.size
    && canvasPt.y >= rect.y
    && canvasPt.y <= rect.y + rect.size
  );
}

function drawPanTool(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (!gameStarted || won) return;
  const rect = getPanToolRect(canvas);
  const cx = rect.x + rect.size / 2;
  const cy = rect.y + rect.size / 2;

  ctx.save();

  ctx.fillStyle = panMode
    ? 'rgba(70, 130, 200, 0.22)'
    : 'rgba(245, 238, 224, 0.72)';
  ctx.strokeStyle = panMode
    ? 'rgba(40, 90, 170, 0.95)'
    : 'rgba(91, 63, 31, 0.62)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.size, rect.size, 6);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = panMode ? '#285aaa' : '#5b3f1f';
  ctx.fillStyle = panMode ? '#285aaa' : '#5b3f1f';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const s = rect.size / 64;

  ctx.beginPath();
  ctx.moveTo(cx - 10 * s, cy + 8 * s);
  ctx.lineTo(cx - 10 * s, cy - 12 * s);
  ctx.quadraticCurveTo(cx - 10 * s, cy - 17 * s, cx - 5 * s, cy - 17 * s);
  ctx.quadraticCurveTo(cx, cy - 17 * s, cx, cy - 12 * s);
  ctx.lineTo(cx, cy - 3 * s);
  ctx.lineTo(cx, cy - 17 * s);
  ctx.quadraticCurveTo(cx, cy - 22 * s, cx + 5 * s, cy - 22 * s);
  ctx.quadraticCurveTo(cx + 10 * s, cy - 22 * s, cx + 10 * s, cy - 17 * s);
  ctx.lineTo(cx + 10 * s, cy - 3 * s);
  ctx.lineTo(cx + 10 * s, cy - 14 * s);
  ctx.quadraticCurveTo(cx + 10 * s, cy - 18 * s, cx + 15 * s, cy - 18 * s);
  ctx.quadraticCurveTo(cx + 20 * s, cy - 18 * s, cx + 20 * s, cy - 13 * s);
  ctx.lineTo(cx + 20 * s, cy + 5 * s);
  ctx.quadraticCurveTo(cx + 20 * s, cy + 18 * s, cx + 8 * s, cy + 21 * s);
  ctx.lineTo(cx - 2 * s, cy + 21 * s);
  ctx.quadraticCurveTo(cx - 11 * s, cy + 21 * s, cx - 17 * s, cy + 14 * s);
  ctx.lineTo(cx - 25 * s, cy + 5 * s);
  ctx.quadraticCurveTo(cx - 28 * s, cy + 1 * s, cx - 24 * s, cy - 2 * s);
  ctx.quadraticCurveTo(cx - 20 * s, cy - 5 * s, cx - 16 * s, cy - 1 * s);
  ctx.lineTo(cx - 10 * s, cy + 8 * s);
  ctx.stroke();

  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 3 * s);
  ctx.lineTo(cx, cy + 7 * s);
  ctx.moveTo(cx + 10 * s, cy - 3 * s);
  ctx.lineTo(cx + 10 * s, cy + 7 * s);
  ctx.stroke();

  ctx.restore();
}

function getSelectedPlacedPieces(): Piece[] {
  if (!puzzle || selectedPieceIds.size === 0) return [];
  return puzzle.pieces.filter((p) => p.isPlaced && selectedPieceIds.has(p.id));
}

function createSelectionFrameForIds(ids: Iterable<number>): SelectionFrame | null {
  if (!puzzle) return null;
  const idSet = new Set(ids);
  if (idSet.size === 0) return null;
  const selectedPieces = puzzle.pieces.filter((p) => p.isPlaced && idSet.has(p.id));
  if (selectedPieces.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const piece of selectedPieces) {
    const worldPoly = transform.applyToPolygon(piece.transform, piece.polygon);
    for (const v of worldPoly.vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
    angle: 0,
  };
}

function setSelectedPieceIds(ids: Iterable<number>): void {
  selectedPieceIds = new Set(ids);
  selectionFrame = createSelectionFrameForIds(selectedPieceIds);
}

function clearSelection(): void {
  selectedPieceIds.clear();
  selectionFrame = null;
}

function refreshSelectionFrame(): void {
  selectionFrame = createSelectionFrameForIds(selectedPieceIds);
}

function getSelectionBounds(): SelectionFrame | null {
  if (selectionFrame) return selectionFrame;
  const selectedPieces = getSelectedPlacedPieces();
  if (selectedPieces.length === 0) return null;
  refreshSelectionFrame();
  return selectionFrame;
}

function rotateLocalPoint(frame: SelectionFrame, localX: number, localY: number): Point {
  const c = Math.cos(frame.angle);
  const s = Math.sin(frame.angle);
  return {
    x: frame.cx + localX * c - localY * s,
    y: frame.cy + localX * s + localY * c,
  };
}

function toSelectionLocal(frame: SelectionFrame, p: Point): Point {
  const dx = p.x - frame.cx;
  const dy = p.y - frame.cy;
  const c = Math.cos(-frame.angle);
  const s = Math.sin(-frame.angle);
  return {
    x: dx * c - dy * s,
    y: dx * s + dy * c,
  };
}

function getSelectionRotateHandlePos(frame: SelectionFrame): Point {
  return rotateLocalPoint(
    frame,
    0,
    -frame.height / 2 - ROTATE_HANDLE_OFFSET / sceneXform.zoom,
  );
}

function drawSelectionFrame(ctx: CanvasRenderingContext2D): void {
  const frame = getSelectionBounds();
  if (!frame) return;

  const handle = getSelectionRotateHandlePos(frame);
  const hr = ROTATE_HANDLE_RADIUS / sceneXform.zoom;

  ctx.save();
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, hr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(139, 105, 20, 0.85)';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2 / sceneXform.zoom;
  ctx.stroke();

  const ar = hr * 0.4;
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, ar, -Math.PI * 0.7, Math.PI * 0.5);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5 / sceneXform.zoom;
  ctx.stroke();
  ctx.restore();
}

function hitTestSelectionRotateHandle(scenePt: Point): SelectionFrame | null {
  const frame = getSelectionBounds();
  if (!frame) return null;
  const handle = getSelectionRotateHandlePos(frame);
  const hr = ROTATE_HANDLE_RADIUS / sceneXform.zoom;
  const threshold = hr + 5 / sceneXform.zoom;
  const dx = scenePt.x - handle.x;
  const dy = scenePt.y - handle.y;
  return dx * dx + dy * dy < threshold * threshold ? frame : null;
}

function isInsideSelectionBounds(scenePt: Point): boolean {
  const frame = getSelectionBounds();
  if (!frame) return false;
  const local = toSelectionLocal(frame, scenePt);
  return (
    local.x >= -frame.width / 2
    && local.x <= frame.width / 2
    && local.y >= -frame.height / 2
    && local.y <= frame.height / 2
  );
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
  setSelectedPieceIds(nextSelection);
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

function createTrayDragImage(piece: Piece): HTMLCanvasElement {
  const dragCanvas = document.createElement('canvas');
  dragCanvas.width = THUMBNAIL_SIZE;
  dragCanvas.height = THUMBNAIL_SIZE;
  dragCanvas.style.position = 'fixed';
  dragCanvas.style.left = '-10000px';
  dragCanvas.style.top = '-10000px';
  dragCanvas.style.pointerEvents = 'none';
  dragCanvas.style.background = 'transparent';
  renderSingleThumbnail(dragCanvas, piece);
  document.body.appendChild(dragCanvas);
  return dragCanvas;
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

    if (selectedTrayPieceKind === group.kind) {
      card.classList.add('selected');
    }

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = THUMBNAIL_SIZE;
    thumbCanvas.height = THUMBNAIL_SIZE;
    thumbCanvas.draggable = true;
    thumbCanvas.style.cursor = 'grab';
    renderSingleThumbnail(thumbCanvas, piece);

    const label = document.createElement('span');
    label.className = 'tray-label';
    label.textContent = `${group.label} x${group.pieces.length}`;

    card.appendChild(thumbCanvas);
    card.appendChild(label);

    card.addEventListener('click', () => {
      if (!gameStarted) return;
      selectedTrayPieceKind = selectedTrayPieceKind === group.kind ? null : group.kind;
      updateTraySelection();
    });

    thumbCanvas.addEventListener('dragstart', (e) => {
      if (!gameStarted) {
        e.preventDefault();
        return;
      }
      selectedTrayPieceKind = group.kind;
      e.dataTransfer?.setData('text/plain', `puzzle-piece-kind:${group.kind}`);
      e.dataTransfer?.setData('application/x-puzzle-piece-kind', group.kind);
      const dragImage = createTrayDragImage(piece);
      e.dataTransfer?.setDragImage(dragImage, THUMBNAIL_SIZE / 2, THUMBNAIL_SIZE / 2);
      window.setTimeout(() => dragImage.remove(), 0);
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

function resetTimer(): void {
  if (timerIntervalId !== null) {
    window.clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
  gameStarted = false;
  timerStartMs = 0;
  elapsedMs = 0;
  timerFrozen = false;
  const timer = document.getElementById('solve-timer') as HTMLDivElement | null;
  if (timer) {
    timer.innerHTML = '';
    timer.dataset.format = '';
    timer.classList.add('hidden');
  }
}

function startPuzzleTimer(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (gameStarted || won) return;
  gameStarted = true;
  timerFrozen = false;
  timerStartMs = performance.now();
  updateTimerDom();
  if (timerIntervalId !== null) window.clearInterval(timerIntervalId);
  timerIntervalId = window.setInterval(updateTimerDom, 33);
  render(ctx, canvas);
}

function stopPuzzleTimer(): void {
  finishTimerAfterFlip();
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
    const isSpectre = parsed['tileType'] !== 'hat';
    curvedEdges = isSpectre && parsed['curvedEdges'] === true;
    curveData = curvedEdges ? (parsed['curveData'] || null) : null;
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
  resetTimer();
  selectedTrayPieceKind = null;
  dragInfo = null;
  rotateDragInfo = null;
  marqueeInfo = null;
  trashDropActive = false;
  clearSelection();
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
      resetTimer();
      selectedTrayPieceKind = null;
      dragInfo = null;
      rotateDragInfo = null;
      marqueeInfo = null;
      trashDropActive = false;
      clearSelection();
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

function returnPiecesToTray(ids: Iterable<number>, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (!puzzle) return;
  const idSet = new Set(ids);
  for (const piece of puzzle.pieces) {
    if (!idSet.has(piece.id)) continue;
    piece.isPlaced = false;
    piece.transform = transform.identity();
  }

  trashDropActive = false;
  hoveredPieceId = null;
  clearSelection();
  updateTray();
  updateStatusBar();
  render(ctx, canvas);
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
  checkWinAndRender(ctx, canvas);
  render(ctx, canvas);
}

function checkWinAndRender(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): void {
  if (!puzzle || won) return;
  const result = checkWinCondition(puzzle);
  if (result.isComplete) {
    stopPuzzleTimer();
    won = true;
    dragInfo = null;
    rotateDragInfo = null;
    marqueeInfo = null;
    trashDropActive = false;
    hoveredPieceId = null;
    clearSelection();
    render(ctx, canvas);
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
  p.textContent = `Congratulations! You solved the puzzle in ${formatElapsedFull(elapsedMs)}.`;

  const actions = document.createElement('div');
  actions.className = 'victory-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save Image';
  saveBtn.addEventListener('click', () => {
    const mainCanvas = document.getElementById('main-canvas') as HTMLCanvasElement;
    saveImage(mainCanvas);
    removeVictoryOverlay();
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
  checkWinAndRender(ctx, canvas);
}

function doReset(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (!initialJSON) return;
  cancelViewRebound();
  anim.cancelAll();
  puzzle = importPuzzle(initialJSON);
  won = false;
  resetTimer();
  selectedTrayPieceKind = null;
  dragInfo = null;
  rotateDragInfo = null;
  marqueeInfo = null;
  trashDropActive = false;
  clearSelection();
  hoveredPieceId = null;
  removeVictoryOverlay();

  extractCurveMeta(initialJSON);

  buildColorMap();
  updateTray();
  updateStatusBar();
  render(ctx, canvas);
}

function saveImage(canvas: HTMLCanvasElement): void {
  if (!puzzle) return;
  const imageCanvas = createAchievementImageCanvas(canvas);
  imageCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'spectre-puzzle-result.png';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

function createAchievementImageCanvas(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = 1080;
  out.height = 1600;
  const ctx = out.getContext('2d');
  if (!ctx || !puzzle) return out;

  drawAchievementBackground(ctx, out.width, out.height);

  ctx.save();
  ctx.fillStyle = '#4a3c28';
  ctx.font = '800 64px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Puzzle Complete', out.width / 2, 110);

  ctx.fillStyle = '#7a6c58';
  ctx.font = '600 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('Spectre Puzzle', out.width / 2, 164);
  ctx.restore();

  drawAchievementPuzzle(ctx, sourceCanvas, {
    x: 90,
    y: 260,
    w: 900,
    h: 900,
  });

  drawAchievementTime(ctx, formatElapsedCompact(elapsedMs || currentElapsedMs()), out.width / 2, 1380);

  return out;
}

function drawAchievementBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#efe4d1');
  gradient.addColorStop(0.55, '#d8c7a9');
  gradient.addColorStop(1, '#c7b28f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#8d7654';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.12;
  for (let x = 0; x < w; x += 11) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAchievementPuzzle(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
): void {
  if (!puzzle) return;

  ctx.save();
  ctx.shadowColor = 'rgba(74, 60, 40, 0.28)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#eadcc4';
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 16);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(107, 91, 62, 0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.clip();

  ctx.fillStyle = '#dfcfb3';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#8d7654';
  ctx.lineWidth = 1;
  for (let gx = rect.x; gx <= rect.x + rect.w; gx += 7) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, rect.y);
    ctx.lineTo(gx + 0.5, rect.y + rect.h);
    ctx.stroke();
  }
  for (let gy = rect.y; gy <= rect.y + rect.h; gy += 7) {
    ctx.beginPath();
    ctx.moveTo(rect.x, gy + 0.5);
    ctx.lineTo(rect.x + rect.w, gy + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const bbox = polygon.boundingBox(puzzle.framePolygon);
  const fw = bbox.max.x - bbox.min.x;
  const fh = bbox.max.y - bbox.min.y;
  const zoom = Math.min((rect.w * 0.82) / fw, (rect.h * 0.82) / fh);
  const panX = rect.x + rect.w / 2 - ((bbox.min.x + bbox.max.x) / 2) * zoom;
  const panY = rect.y + rect.h / 2 - ((bbox.min.y + bbox.max.y) / 2) * zoom;

  const oldScene = sceneXform;
  const oldSelection = selectionFrame;
  const oldSelectedIds = selectedPieceIds;
  const oldDrag = dragInfo;
  const oldRotate = rotateDragInfo;
  const oldMarquee = marqueeInfo;
  const oldHover = hoveredPieceId;
  const oldGameStarted = gameStarted;

  sceneXform = createSceneTransform({ panX, panY, zoom, centerX: 0, centerY: 0, rotation: 0 });
  gameStarted = true;
  selectionFrame = null;
  selectedPieceIds = new Set();
  dragInfo = null;
  rotateDragInfo = null;
  marqueeInfo = null;
  hoveredPieceId = null;

  ctx.save();
  applyToCtx(ctx, sceneXform);
  drawFrame(ctx, puzzle.framePolygon, puzzle.frameTilePolygons);
  for (const piece of puzzle.pieces.filter((p) => p.isPlaced)) {
    drawPiece(ctx, piece, false);
  }
  ctx.restore();

  sceneXform = oldScene;
  selectionFrame = oldSelection;
  selectedPieceIds = oldSelectedIds;
  dragInfo = oldDrag;
  rotateDragInfo = oldRotate;
  marqueeInfo = oldMarquee;
  hoveredPieceId = oldHover;
  gameStarted = oldGameStarted;

  ctx.restore();
}

function drawAchievementTime(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.fillStyle = '#7a6c58';
  ctx.font = '800 30px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Completion Time', x, y - 82);

  const panelW = 62;
  const panelH = 92;
  const gap = 12;
  const sepW = 28;
  const chars = [...text];
  const totalW = chars.reduce((sum, ch, i) => {
    const charW = /\d/.test(ch) ? panelW : sepW;
    return sum + charW + (i === chars.length - 1 ? 0 : gap);
  }, 0);

  let cursor = x - totalW / 2;
  for (const ch of chars) {
    if (/\d/.test(ch)) {
      drawAchievementFlipDigit(ctx, ch, cursor, y - panelH / 2, panelW, panelH);
      cursor += panelW + gap;
    } else {
      ctx.fillStyle = '#3f3320';
      ctx.font = ch === '.' ? '900 52px Arial, Helvetica, sans-serif' : '900 64px Arial, Helvetica, sans-serif';
      ctx.fillText(ch, cursor + sepW / 2, y + (ch === '.' ? 20 : -4));
      cursor += sepW + gap;
    }
  }
  ctx.restore();
}

function drawAchievementFlipDigit(
  ctx: CanvasRenderingContext2D,
  digit: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.fillStyle = '#171512';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 7);
  ctx.fill();

  ctx.fillStyle = '#332e27';
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, w - 2, h / 2 - 1, 6);
  ctx.fill();

  ctx.fillStyle = '#171512';
  ctx.beginPath();
  ctx.roundRect(x + 1, y + h / 2, w - 2, h / 2 - 1, 6);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 2, y + h / 2);
  ctx.lineTo(x + w - 2, y + h / 2);
  ctx.stroke();

  ctx.fillStyle = '#f7efe0';
  ctx.font = `900 ${Math.floor(h * 0.78)}px Arial Black, Impact, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(digit, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function onPointerDown(
  e: PointerEvent,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  if (!puzzle) return;
  const model = puzzle;
  cancelViewRebound();

  if (e.button === 1) {
    isPanning = true;
    const rect = canvas.getBoundingClientRect();
    panStartX = e.clientX - rect.left;
    panStartY = e.clientY - rect.top;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
    e.preventDefault();
    return;
  }

  if (e.button !== 0) return;

  const canvasPt = getCanvasPoint(e, canvas);
  if (isInPanToolZone(canvasPt, canvas)) {
    panMode = !panMode;
    canvas.style.cursor = panMode ? 'grab' : '';
    e.preventDefault();
    render(ctx, canvas);
    return;
  }

  if (!gameStarted) {
    const button = getStartButtonHitCircle();
    if (button) {
      const dx = canvasPt.x - button.x;
      const dy = canvasPt.y - button.y;
      if (dx * dx + dy * dy <= button.r * button.r) {
        startPuzzleTimer(ctx, canvas);
      }
    }
    e.preventDefault();
    return;
  }

  if (panMode) {
    isPanning = true;
    const rect = canvas.getBoundingClientRect();
    panStartX = e.clientX - rect.left;
    panStartY = e.clientY - rect.top;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  const scenePt = toScene(e, canvas);

  if (rotateDragInfo !== null) {
    rotateDragInfo = null;
  }
  marqueeInfo = null;

  const rotateBounds = hitTestSelectionRotateHandle(scenePt);
  if (rotateBounds) {
    const groupIds = Array.from(selectedPieceIds).filter((id) =>
      model.pieces.some((p) => p.id === id && p.isPlaced),
    );
    rotateDragInfo = {
      startAngle: Math.atan2(scenePt.y - rotateBounds.cy, scenePt.x - rotateBounds.cx),
      pivotX: rotateBounds.cx,
      pivotY: rotateBounds.cy,
      groupIds,
      startSelectionFrame: { ...rotateBounds },
      startTransforms: new Map(
        groupIds
          .map((id): [number, AffineTransform] | null => {
            const piece = model.pieces.find((p) => p.id === id && p.isPlaced);
            return piece ? [id, piece.transform] : null;
          })
          .filter((entry): entry is [number, AffineTransform] => entry !== null),
      ),
    };
    hoveredPieceId = null;
    canvas.setPointerCapture(e.pointerId);
    render(ctx, canvas);
    return;
  }

  const hitPiece = getPlacedPieceAt(scenePt);
  if (hitPiece) {
    const groupIds = selectedPieceIds.has(hitPiece.id)
      ? Array.from(selectedPieceIds)
      : [hitPiece.id];
    if (!selectedPieceIds.has(hitPiece.id)) {
      setSelectedPieceIds(groupIds);
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
      startSelectionFrame: selectionFrame ? { ...selectionFrame } : null,
      startTransforms: new Map(
        groupIds
          .map((id): [number, AffineTransform] | null => {
            const piece = model.pieces.find((p) => p.id === id && p.isPlaced);
            return piece ? [id, piece.transform] : null;
          })
          .filter((entry): entry is [number, AffineTransform] => entry !== null),
      ),
    };
    canvas.setPointerCapture(e.pointerId);
    render(ctx, canvas);
    return;
  }

  if (selectedPieceIds.size > 1 && isInsideSelectionBounds(scenePt)) {
    const groupIds = Array.from(selectedPieceIds);
    dragInfo = {
      pieceId: groupIds[0],
      anchorOffset: { x: 0, y: 0 },
      startRotation: 0,
      groupIds,
      startScenePt: scenePt,
      startSelectionFrame: selectionFrame ? { ...selectionFrame } : null,
      startTransforms: new Map(
        groupIds
          .map((id): [number, AffineTransform] | null => {
            const piece = model.pieces.find((p) => p.id === id && p.isPlaced);
            return piece ? [id, piece.transform] : null;
          })
          .filter((entry): entry is [number, AffineTransform] => entry !== null),
      ),
    };
    canvas.setPointerCapture(e.pointerId);
    render(ctx, canvas);
    return;
  }

  clearSelection();
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

  if (isPanning) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - panStartX;
    const dy = my - panStartY;
    sceneXform = elasticViewTransform({
      ...sceneXform,
      panX: sceneXform.panX + dx,
      panY: sceneXform.panY + dy,
    });
    panStartX = mx;
    panStartY = my;
    updateTimerPosition();
    render(ctx, canvas);
    return;
  }

  const scenePt = toScene(e, canvas);

  const rdInfo = rotateDragInfo;
  if (rdInfo !== null) {
    const currentAngle = Math.atan2(scenePt.y - rdInfo.pivotY, scenePt.x - rdInfo.pivotX);
    const angleDelta = currentAngle - rdInfo.startAngle;
    const rotationAroundSelection = transform.compose(
      transform.translation(rdInfo.pivotX, rdInfo.pivotY),
      transform.compose(
        transform.rotation(angleDelta),
        transform.translation(-rdInfo.pivotX, -rdInfo.pivotY),
      ),
    );
    for (const id of rdInfo.groupIds) {
      const piece = puzzle.pieces.find((p) => p.id === id);
      const startTransform = rdInfo.startTransforms.get(id);
      if (!piece || !startTransform) continue;
      piece.transform = transform.compose(
        rotationAroundSelection,
        startTransform,
      );
    }
    selectionFrame = {
      ...rdInfo.startSelectionFrame,
      angle: rdInfo.startSelectionFrame.angle + angleDelta,
    };
    render(ctx, canvas);
    return;
  }

  const drag = dragInfo;
  if (drag) {
    trashDropActive = isInTrashDropZone(getCanvasPoint(e, canvas), canvas);
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
      if (drag.startSelectionFrame) {
        selectionFrame = {
          ...drag.startSelectionFrame,
          cx: drag.startSelectionFrame.cx + delta.x,
          cy: drag.startSelectionFrame.cy + delta.y,
        };
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
    if (drag.startSelectionFrame) {
      const delta = point.subtract(scenePt, drag.startScenePt);
      selectionFrame = {
        ...drag.startSelectionFrame,
        cx: drag.startSelectionFrame.cx + delta.x,
        cy: drag.startSelectionFrame.cy + delta.y,
      };
    }
    render(ctx, canvas);
    return;
  }

  if (trashDropActive) {
    trashDropActive = false;
    render(ctx, canvas);
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
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = panMode ? 'grab' : '';
    reboundViewIntoBounds(ctx, canvas);
    return;
  }

  if (rotateDragInfo !== null) {
    rotateDragInfo = null;
    checkWinAndRender(ctx, canvas);
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

  if (isInTrashDropZone(getCanvasPoint(e, canvas), canvas)) {
    returnPiecesToTray(drag.groupIds, ctx, canvas);
    return;
  }

  trashDropActive = false;
  if (piece && drag.groupIds.length <= 1) {
    trySnap(piece, ctx, canvas);
    refreshSelectionFrame();
  } else {
    checkWinAndRender(ctx, canvas);
    refreshSelectionFrame();
  }
  checkWinAndRender(ctx, canvas);
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

  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    cancelViewRebound();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = clampZoom(sceneXform.zoom * zoomFactor);

    // Zoom centered on mouse cursor: keep the scene point under cursor fixed
    const scenePtBefore = screenToScene(sceneXform, mx, my);
    const zoomedXform = { ...sceneXform, zoom: newZoom };
    const scenePtAfter = screenToScene(zoomedXform, mx, my);
    sceneXform = clampViewTransform({
      ...zoomedXform,
      panX: zoomedXform.panX + (scenePtAfter.x - scenePtBefore.x) * newZoom,
      panY: zoomedXform.panY + (scenePtAfter.y - scenePtBefore.y) * newZoom,
    });

    updateTimerPosition();
    render(renderCtx, canvas);
  }, { passive: false });

  canvas.addEventListener('dragover', (e) => {
    if (!gameStarted) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  });
  canvas.addEventListener('drop', (e) => {
    if (!gameStarted) return;
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
