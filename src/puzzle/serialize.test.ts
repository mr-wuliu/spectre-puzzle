import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportPuzzle, importPuzzle, downloadPuzzleJSON, loadPuzzleJSON } from './serialize';
import { createPuzzleModel } from './puzzle-model';
import { createPiece } from './piece';
import { create as createPolygon } from '../geometry/polygon';
import { translation, rotation, identity, compose } from '../geometry/transform';
import type { PuzzleModel } from './puzzle-model';
import type { AffineTransform } from '../geometry/transform';

function makeTriangle(id: number, isFramePiece = false) {
  const poly = createPolygon([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0.5, y: 1 },
  ]);
  const xform = isFramePiece ? identity() : translation(id * 10, id * 5);
  return createPiece(id, poly, xform, [1, 2, -3], isFramePiece);
}

function makeSquare(id: number) {
  const poly = createPolygon([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ]);
  return createPiece(id, poly, translation(id, 0), [10, 20, 30, 40], false);
}

function makeSampleModel(): PuzzleModel {
  const framePoly = createPolygon([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
  const pieces = [makeTriangle(1), makeTriangle(2), makeSquare(3)];

  const solutionMap = new Map<number, AffineTransform>();
  solutionMap.set(1, translation(5, 5));
  solutionMap.set(2, compose(translation(3, 3), rotation(Math.PI / 4)));
  solutionMap.set(3, identity());

  return createPuzzleModel(pieces, framePoly, solutionMap);
}

function makeModelWithFrameTiles(): PuzzleModel {
  const model = makeSampleModel();
  const frameTilePolys = [
    createPolygon([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ]),
    createPolygon([
      { x: 5, y: 5 },
      { x: 7, y: 5 },
      { x: 7, y: 7 },
      { x: 5, y: 7 },
    ]),
  ];
  return createPuzzleModel(model.pieces, model.framePolygon, model.solutionMap, frameTilePolys);
}

describe('exportPuzzle', () => {
  it('produces valid JSON with all required fields', () => {
    const model = makeSampleModel();
    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe('1.0');
    expect(parsed.frame.vertices).toHaveLength(4);
    expect(parsed.pieces).toHaveLength(3);
    expect(parsed.solution).toHaveLength(3);
    expect(parsed.tileType).toBe('spectre');
    expect(parsed.curvedEdges).toBe(true);
  });

  it('serializes frameTilePolygons when present', () => {
    const model = makeModelWithFrameTiles();
    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);

    expect(parsed.frameTiles).toBeDefined();
    expect(parsed.frameTiles).toHaveLength(2);
    expect(parsed.frameTiles[0].vertices).toHaveLength(4);
    expect(parsed.frameTiles[1].vertices).toHaveLength(4);
  });

  it('omits frameTiles when frameTilePolygons is empty', () => {
    const model = makeSampleModel();
    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);

    expect(parsed.frameTiles).toBeUndefined();
  });

  it('respects tileType and curvedEdges parameters', () => {
    const model = makeSampleModel();
    const json = exportPuzzle(model, 'hat', false);
    const parsed = JSON.parse(json);

    expect(parsed.tileType).toBe('hat');
    expect(parsed.curvedEdges).toBe(false);
  });

  it('serializes piece polygon vertices correctly', () => {
    const model = makeSampleModel();
    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);

    expect(parsed.pieces[0].polygon.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ]);
  });

  it('serializes transform matrix as 9-element array', () => {
    const model = makeSampleModel();
    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);

    for (const piece of parsed.pieces) {
      expect(piece.initialTransform.matrix).toHaveLength(9);
    }
  });

  it('serializes side IDs from piece sides', () => {
    const model = makeSampleModel();
    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);

    expect(parsed.pieces[0].sideIds).toEqual([1, 2, -3]);
  });

  it('serializes solution map as array of id/transform pairs', () => {
    const model = makeSampleModel();
    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);

    expect(parsed.solution).toHaveLength(3);
    const ids = parsed.solution.map((s: { id: number }) => s.id).sort();
    expect(ids).toEqual([1, 2, 3]);
  });

  it('handles empty solution map', () => {
    const framePoly = createPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    const piece = makeTriangle(1);
    const model = createPuzzleModel([piece], framePoly);

    const json = exportPuzzle(model);
    const parsed = JSON.parse(json);
    expect(parsed.solution).toEqual([]);
  });
});

describe('importPuzzle', () => {
  it('round-trips a full puzzle model preserving all data', () => {
    const original = makeSampleModel();
    const json = exportPuzzle(original);
    const restored = importPuzzle(json);

    expect(restored.pieces).toHaveLength(original.pieces.length);

    for (let i = 0; i < original.pieces.length; i++) {
      const op = original.pieces[i];
      const rp = restored.pieces[i];

      expect(rp.id).toBe(op.id);
      expect(rp.isFramePiece).toBe(op.isFramePiece);
      expect(rp.polygon.vertices.length).toBe(op.polygon.vertices.length);

      for (let v = 0; v < op.polygon.vertices.length; v++) {
        expect(rp.polygon.vertices[v].x).toBeCloseTo(op.polygon.vertices[v].x);
        expect(rp.polygon.vertices[v].y).toBeCloseTo(op.polygon.vertices[v].y);
      }

      expect(rp.transform.matrix.length).toBe(9);
      for (let m = 0; m < 9; m++) {
        expect(rp.transform.matrix[m]).toBeCloseTo(op.transform.matrix[m]);
      }

      expect(rp.sides.map((s) => s.id)).toEqual(op.sides.map((s) => s.id));
    }

    expect(restored.framePolygon.vertices.length).toBe(original.framePolygon.vertices.length);
    for (let v = 0; v < original.framePolygon.vertices.length; v++) {
      expect(restored.framePolygon.vertices[v].x).toBeCloseTo(original.framePolygon.vertices[v].x);
      expect(restored.framePolygon.vertices[v].y).toBeCloseTo(original.framePolygon.vertices[v].y);
    }

    expect(restored.solutionMap.size).toBe(original.solutionMap.size);
    original.solutionMap.forEach((xform, id) => {
      expect(restored.solutionMap.has(id)).toBe(true);
      const restoredXform = restored.solutionMap.get(id)!;
      for (let m = 0; m < 9; m++) {
        expect(restoredXform.matrix[m]).toBeCloseTo(xform.matrix[m]);
      }
    });
  });

  it('round-trips frame piece correctly', () => {
    const framePoly = createPolygon([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ]);
    const framePiece = makeTriangle(0, true);
    const model = createPuzzleModel([framePiece], framePoly);

    const json = exportPuzzle(model);
    const restored = importPuzzle(json);

    expect(restored.pieces[0].isFramePiece).toBe(true);
    expect(restored.pieces[0].id).toBe(0);
  });

  it('round-trips frameTilePolygons correctly', () => {
    const original = makeModelWithFrameTiles();
    expect(original.frameTilePolygons).toHaveLength(2);

    const json = exportPuzzle(original);
    const restored = importPuzzle(json);

    expect(restored.frameTilePolygons).toHaveLength(2);
    for (let ti = 0; ti < original.frameTilePolygons.length; ti++) {
      const origVerts = original.frameTilePolygons[ti].vertices;
      const restVerts = restored.frameTilePolygons[ti].vertices;
      expect(restVerts.length).toBe(origVerts.length);
      for (let v = 0; v < origVerts.length; v++) {
        expect(restVerts[v].x).toBeCloseTo(origVerts[v].x);
        expect(restVerts[v].y).toBeCloseTo(origVerts[v].y);
      }
    }
  });

  it('imports puzzle without frameTiles as empty frameTilePolygons', () => {
    const model = makeSampleModel(); // no frameTilePolygons
    const json = exportPuzzle(model);
    const restored = importPuzzle(json);

    expect(restored.frameTilePolygons).toEqual([]);
  });

  it('end-to-end: spectre tiles with frameTilePolygons serialize and restore', () => {
    // Simulate the real create.ts flow: multiple spectre-shaped pieces
    const SQRT3_HALF = Math.sqrt(3) / 2;
    const spectreVerts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1.5, y: -SQRT3_HALF },
      { x: 1.5 + SQRT3_HALF, y: 0.5 - SQRT3_HALF },
      { x: 1.5 + SQRT3_HALF, y: 1.5 - SQRT3_HALF },
      { x: 2.5 + SQRT3_HALF, y: 1.5 - SQRT3_HALF },
      { x: 3 + SQRT3_HALF, y: 1.5 },
      { x: 3, y: 2 },
      { x: 3 - SQRT3_HALF, y: 1.5 },
      { x: 2.5 - SQRT3_HALF, y: 1.5 + SQRT3_HALF },
      { x: 1.5 - SQRT3_HALF, y: 1.5 + SQRT3_HALF },
      { x: 0.5 - SQRT3_HALF, y: 1.5 + SQRT3_HALF },
      { x: -SQRT3_HALF, y: 1.5 },
      { x: 0, y: 1 },
    ];

    // Create 3 pieces at different positions
    const offset = 3 + SQRT3_HALF + 0.5;
    const pieces = [
      createPiece(1, createPolygon(spectreVerts), identity(), new Array(14).fill(0), false),
      createPiece(2, createPolygon(spectreVerts), translation(offset, 0), new Array(14).fill(0), false),
      createPiece(3, createPolygon(spectreVerts), translation(offset * 2, 0), new Array(14).fill(0), false),
    ];

    const framePoly = createPolygon([
      { x: -2, y: -2 },
      { x: offset * 2 + 6, y: -2 },
      { x: offset * 2 + 6, y: 5 },
      { x: -2, y: 5 },
    ]);

    // frameTilePolys = the piece polygons (holes in frame)
    const frameTilePolys = pieces.map(p => {
      const verts = p.polygon.vertices.map(v => ({
        x: v.x + (p.transform.matrix[6] as number),
        y: v.y + (p.transform.matrix[7] as number),
      }));
      return createPolygon(verts);
    });

    const solutionMap = new Map<number, AffineTransform>();
    pieces.forEach(p => solutionMap.set(p.id, identity()));

    const model = createPuzzleModel(pieces, framePoly, solutionMap, frameTilePolys);

    // Serialize
    const json = exportPuzzle(model, 'spectre', false);

    // Deserialize
    const restored = importPuzzle(json);

    expect(restored.pieces).toHaveLength(3);
    expect(restored.frameTilePolygons).toHaveLength(3);
    expect(restored.solutionMap.size).toBe(3);

    // Each piece should have 14 vertices (spectre shape)
    for (const p of restored.pieces) {
      expect(p.polygon.vertices).toHaveLength(14);
    }
    // Each frameTilePolygon should have 14 vertices
    for (const ftp of restored.frameTilePolygons) {
      expect(ftp.vertices).toHaveLength(14);
    }
  });

  it('throws on invalid JSON', () => {
    expect(() => importPuzzle('not json at all')).toThrow('not valid JSON');
  });

  it('throws on missing version field', () => {
    const doc = {
      frame: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pieces: [],
      solution: [],
      tileType: 'hat',
      curvedEdges: true,
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('missing or invalid "version"');
  });

  it('throws on unsupported version', () => {
    const doc = {
      version: '2.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pieces: [],
      solution: [],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('Unsupported puzzle version');
  });

  it('throws on missing frame vertices', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: 'bad' },
      pieces: [],
      solution: [],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('frame.vertices');
  });

  it('throws on piece with invalid sideIds', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pieces: [
        {
          id: 1,
          polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
          initialTransform: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
          sideIds: 'not-array',
          isFramePiece: false,
        },
      ],
      solution: [],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('sideIds');
  });

  it('throws on piece with wrong sideIds length', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pieces: [
        {
          id: 1,
          polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
          initialTransform: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
          sideIds: [1, 2],
          isFramePiece: false,
        },
      ],
      solution: [],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('sideIds length');
  });

  it('throws on transform with wrong matrix size', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pieces: [
        {
          id: 1,
          polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
          initialTransform: { matrix: [1, 0, 0] },
          sideIds: [1, 2, 3],
          isFramePiece: false,
        },
      ],
      solution: [],
    };
    expect(() => importPuzzle(JSON.stringify(doc))).toThrow('transform.matrix must be 9 numbers');
  });

  it('handles puzzle with no solution entries', () => {
    const doc = {
      version: '1.0',
      frame: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      pieces: [],
      solution: [],
    };
    const model = importPuzzle(JSON.stringify(doc));
    expect(model.solutionMap.size).toBe(0);
  });
});

describe('downloadPuzzleJSON', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let removeChildSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLAnchorElement);
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => node) as unknown as typeof document.body.appendChild);
    removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(((node: Node) => node) as unknown as typeof document.body.removeChild);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a download link with correct filename and clicks it', () => {
    const model = makeSampleModel();
    downloadPuzzleJSON(model, 'test-puzzle.json');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(createElementSpy).toHaveBeenCalledWith('a');

    const anchor = createElementSpy.mock.results[0].value as HTMLAnchorElement;
    expect(anchor.download).toBe('test-puzzle.json');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('uses default filename when not specified', () => {
    const framePoly = createPolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
    const piece = makeTriangle(1);
    const model = createPuzzleModel([piece], framePoly);

    downloadPuzzleJSON(model);

    const anchor = createElementSpy.mock.results[0].value as HTMLAnchorElement;
    expect(anchor.download).toBe('puzzle.json');
  });
});

describe('loadPuzzleJSON', () => {
  it('reads file and returns parsed puzzle', async () => {
    const original = makeSampleModel();
    const json = exportPuzzle(original);

    const file = new File([json], 'puzzle.json', { type: 'application/json' });

    const result = await loadPuzzleJSON(file);

    expect(result.pieces).toHaveLength(original.pieces.length);
    expect(result.framePolygon.vertices.length).toBe(original.framePolygon.vertices.length);
    expect(result.solutionMap.size).toBe(original.solutionMap.size);
  });

  it('rejects on invalid JSON content', async () => {
    const file = new File(['not valid json'], 'bad.json', { type: 'application/json' });
    await expect(loadPuzzleJSON(file)).rejects.toThrow('not valid JSON');
  });

  it('rejects on missing version', async () => {
    const doc = { frame: { vertices: [] }, pieces: [], solution: [] };
    const file = new File([JSON.stringify(doc)], 'bad.json', { type: 'application/json' });
    await expect(loadPuzzleJSON(file)).rejects.toThrow('missing or invalid "version"');
  });
});
