import type { AffineTransform } from '../geometry/transform';
import type { Polygon } from '../geometry/polygon';
import type { PuzzleModel } from './puzzle-model';
import type { EdgeCurveData } from '../tiling/curved';
import { createPuzzleModel } from './puzzle-model';
import { createPiece } from './piece';
import { create as createPolygon } from '../geometry/polygon';

interface SerializedPoint {
  x: number;
  y: number;
}

interface SerializedPiece {
  id: number;
  polygon: { vertices: SerializedPoint[] };
  initialTransform: { matrix: number[] };
  sideIds: number[];
  isFramePiece: boolean;
}

interface SerializedSolution {
  id: number;
  transform: { matrix: number[] };
}

interface SerializedPuzzle {
  version: string;
  frame: { vertices: SerializedPoint[] };
  frameTiles?: { vertices: SerializedPoint[] }[];
  pieces: SerializedPiece[];
  solution: SerializedSolution[];
  tileType: 'hat' | 'spectre';
  curvedEdges: boolean;
  curveData?: EdgeCurveData;
}

function assertObject(val: unknown, label: string): asserts val is Record<string, unknown> {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    throw new Error(`Invalid puzzle data: ${label} must be an object`);
  }
}

function assertArray(val: unknown, label: string): asserts val is unknown[] {
  if (!Array.isArray(val)) {
    throw new Error(`Invalid puzzle data: ${label} must be an array`);
  }
}

function parsePoint(obj: unknown): { x: number; y: number } {
  assertObject(obj, 'point');
  if (typeof obj.x !== 'number' || typeof obj.y !== 'number') {
    throw new Error('Invalid puzzle data: point must have numeric x and y');
  }
  return { x: obj.x as number, y: obj.y as number };
}

function parseMatrix(raw: unknown): readonly [
  number, number, number,
  number, number, number,
  number, number, number,
] {
  assertObject(raw, 'transform');
  const arr = raw['matrix'];
  assertArray(arr, 'transform.matrix');
  if (arr.length !== 9 || arr.some((v) => typeof v !== 'number')) {
    throw new Error('Invalid puzzle data: transform.matrix must be 9 numbers');
  }
  return arr as unknown as readonly [
    number, number, number,
    number, number, number,
    number, number, number,
  ];
}

export function exportPuzzle(
  model: PuzzleModel,
  tileType: 'hat' | 'spectre' = 'spectre',
  curvedEdges: boolean = true,
  curveData?: EdgeCurveData | null,
): string {
  const effectiveCurvedEdges = tileType === 'spectre' && curvedEdges;
  const effectiveCurveData = effectiveCurvedEdges ? curveData : null;
  const pieces: SerializedPiece[] = model.pieces.map((p) => ({
    id: p.id,
    polygon: {
      vertices: p.polygon.vertices.map((v) => ({ x: v.x, y: v.y })),
    },
    initialTransform: {
      matrix: [...p.transform.matrix],
    },
    sideIds: p.sides.map((s) => s.id),
    isFramePiece: p.isFramePiece,
  }));

  const solution: SerializedSolution[] = [];
  model.solutionMap.forEach((xform, id) => {
    solution.push({ id, transform: { matrix: [...xform.matrix] } });
  });

  const doc: SerializedPuzzle = {
    version: '1.0',
    frame: {
      vertices: model.framePolygon.vertices.map((v) => ({
        x: v.x,
        y: v.y,
      })),
    },
    pieces,
    solution,
    tileType,
    curvedEdges: effectiveCurvedEdges,
  };

  if (effectiveCurveData) {
    doc.curveData = effectiveCurveData;
  }

  if (model.frameTilePolygons.length > 0) {
    doc.frameTiles = model.frameTilePolygons.map((p) => ({
      vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
    }));
  }

  return JSON.stringify(doc, null, 2);
}

export function importPuzzle(json: string): PuzzleModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid puzzle data: not valid JSON');
  }

  assertObject(parsed, 'root');

  if (typeof parsed['version'] !== 'string') {
    throw new Error('Invalid puzzle data: missing or invalid "version" field');
  }
  if ((parsed['version'] as string) !== '1.0') {
    throw new Error(`Unsupported puzzle version: ${parsed['version']}`);
  }

  assertObject(parsed['frame'], 'frame');
  assertArray((parsed['frame'] as Record<string, unknown>)['vertices'], 'frame.vertices');
  const frameVerts = ((parsed['frame'] as Record<string, unknown>)['vertices'] as unknown[]).map(
    (v, i) => {
      try {
        return parsePoint(v);
      } catch (e) {
        throw new Error(`Invalid puzzle data: frame.vertices[${i}] - ${(e as Error).message}`);
      }
    },
  );
  const framePolygon: Polygon = createPolygon(frameVerts);

  assertArray(parsed['pieces'], 'pieces');
  const pieces = (parsed['pieces'] as unknown[]).map((raw, i) => {
    assertObject(raw, `pieces[${i}]`);
    const obj = raw as Record<string, unknown>;

    if (typeof obj['id'] !== 'number') {
      throw new Error(`Invalid puzzle data: pieces[${i}].id must be a number`);
    }

    assertObject(obj['polygon'], `pieces[${i}].polygon`);
    const polyObj = obj['polygon'] as Record<string, unknown>;
    assertArray(polyObj['vertices'], `pieces[${i}].polygon.vertices`);
    const verts = (polyObj['vertices'] as unknown[]).map((v, vi) => {
      try {
        return parsePoint(v);
      } catch (e) {
        throw new Error(`Invalid puzzle data: pieces[${i}].polygon.vertices[${vi}] - ${(e as Error).message}`);
      }
    });
    const poly = createPolygon(verts);

    assertObject(obj['initialTransform'], `pieces[${i}].initialTransform`);
    const matrix = parseMatrix(obj['initialTransform']);
    const xform: AffineTransform = { matrix };

    assertArray(obj['sideIds'], `pieces[${i}].sideIds`);
    const sideIds = (obj['sideIds'] as unknown[]).map((s, si) => {
      if (typeof s !== 'number') {
        throw new Error(`Invalid puzzle data: pieces[${i}].sideIds[${si}] must be a number`);
      }
      return s as number;
    });

    if (typeof obj['isFramePiece'] !== 'boolean') {
      throw new Error(`Invalid puzzle data: pieces[${i}].isFramePiece must be a boolean`);
    }

    return createPiece(obj['id'] as number, poly, xform, sideIds, obj['isFramePiece'] as boolean);
  });

  const solutionMap = new Map<number, AffineTransform>();
  if (parsed['solution'] !== undefined) {
    assertArray(parsed['solution'], 'solution');
    for (const raw of parsed['solution'] as unknown[]) {
      assertObject(raw, 'solution entry');
      const entry = raw as Record<string, unknown>;
      if (typeof entry['id'] !== 'number') {
        throw new Error('Invalid puzzle data: solution entry must have numeric id');
      }
      const xformMatrix = parseMatrix(entry['transform']);
      solutionMap.set(entry['id'] as number, { matrix: xformMatrix });
    }
  }

  const frameTilePolygons: Polygon[] = [];
  if (parsed['frameTiles'] !== undefined) {
    assertArray(parsed['frameTiles'], 'frameTiles');
    for (let ti = 0; ti < (parsed['frameTiles'] as unknown[]).length; ti++) {
      const rawTile = (parsed['frameTiles'] as unknown[])[ti];
      assertObject(rawTile, `frameTiles[${ti}]`);
      const tileObj = rawTile as Record<string, unknown>;
      assertArray(tileObj['vertices'], `frameTiles[${ti}].vertices`);
      const tileVerts = (tileObj['vertices'] as unknown[]).map((v, vi) => {
        try {
          return parsePoint(v);
        } catch (e) {
          throw new Error(`Invalid puzzle data: frameTiles[${ti}].vertices[${vi}] - ${(e as Error).message}`);
        }
      });
      frameTilePolygons.push(createPolygon(tileVerts));
    }
  }

  return createPuzzleModel(pieces, framePolygon, solutionMap, frameTilePolygons);
}

export function downloadPuzzleJSON(
  model: PuzzleModel,
  filename: string = 'puzzle.json',
  tileType: 'hat' | 'spectre' = 'spectre',
  curvedEdges: boolean = true,
  curveData?: EdgeCurveData | null,
): void {
  const json = exportPuzzle(model, tileType, curvedEdges, curveData);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

const STORAGE_KEY = 'spectre-puzzle-saved';

export interface SavedPuzzleMeta {
  id: string;
  name: string;
  pieceCount: number;
  tileType: 'hat' | 'spectre';
  createdAt: number;
}

interface SavedPuzzleEntry {
  id: string;
  name: string;
  tileType: 'hat' | 'spectre';
  createdAt: number;
  json: string;
}

function readPuzzleStore(): SavedPuzzleEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

function writePuzzleStore(entries: SavedPuzzleEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function savePuzzleLocal(
  model: PuzzleModel,
  tileType: 'hat' | 'spectre',
  curvedEdges: boolean,
  curveData?: EdgeCurveData | null,
): void {
  try {
    const json = exportPuzzle(model, tileType, curvedEdges, curveData);
    const entry: SavedPuzzleEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: `${tileType === 'hat' ? 'Hat' : 'Spectre'} Puzzle (${model.pieces.length} pcs)`,
      tileType,
      createdAt: Date.now(),
      json,
    };
    const entries = readPuzzleStore();
    entries.push(entry);
    writePuzzleStore(entries);
  } catch (e) {
    console.error('Failed to save puzzle to localStorage:', e);
    throw e;
  }
}

export function loadPuzzleLocal(): PuzzleModel | null {
  try {
    const entries = readPuzzleStore();
    if (entries.length === 0) return null;
    return importPuzzle(entries[entries.length - 1].json);
  } catch {
    return null;
  }
}

export function listSavedPuzzles(): SavedPuzzleMeta[] {
  const entries = readPuzzleStore();
  return entries.map((e) => {
    let pieceCount = 0;
    try {
      const parsed = JSON.parse(e.json);
      if (Array.isArray(parsed.pieces)) pieceCount = parsed.pieces.length;
    } catch { /* ignore */ }
    return {
      id: e.id,
      name: e.name,
      pieceCount,
      tileType: e.tileType,
      createdAt: e.createdAt,
    };
  });
}

export function loadSavedPuzzle(id: string): PuzzleModel | null {
  try {
    const entries = readPuzzleStore();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    return importPuzzle(entry.json);
  } catch (e) {
    console.error('[loadSavedPuzzle] Failed:', e);
    return null;
  }
}

export function deleteSavedPuzzle(id: string): void {
  const entries = readPuzzleStore();
  writePuzzleStore(entries.filter((e) => e.id !== id));
}

export function loadPuzzleJSON(file: File): Promise<PuzzleModel> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read file as text'));
        return;
      }
      try {
        resolve(importPuzzle(reader.result));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsText(file);
  });
}
