/**
 * Hat tile geometry and 4-metatile substitution engine.
 *
 * Ported from Craig Kaplan's hatviz reference implementation
 * (https://github.com/isohedral/hatviz, BSD-3 license).
 * Pure algorithm — no P5.js dependency.
 *
 * The "hat" einstein tile has 13 vertices on a hex grid.
 * The 4-metatile substitution system uses intermediate shapes
 * H (hexagon), T (triangle), P (parallelogram), F (pentagon/trapezoid)
 * that get recursively substituted to produce the final aperiodic tiling.
 */

import type { Point } from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';

// ─── Public types ───────────────────────────────────────────────

export interface Tile {
  polygon: Polygon;
  transform: transform.AffineTransform;
  type: 'hat' | 'hat-reflected';
}

// ─── Constants ──────────────────────────────────────────────────

const SQRT3_HALF = Math.sqrt(3) / 2; // ≈ 0.8660254037844386

// Identity 6-element affine transform [a,b,c,d,e,f]
const IDENT_T: Transform6 = [1, 0, 0, 0, 1, 0];

// ─── Internal transform helpers (6-element affine) ──────────────
// Format: [a, b, tx, d, e, ty] representing matrix |a b tx|
//                                                        |d e ty|
//                                                        |0 0  1|

type Transform6 = [number, number, number, number, number, number];

function mul6(a: Transform6, b: Transform6): Transform6 {
  return [
    a[0] * b[0] + a[1] * b[3],
    a[0] * b[1] + a[1] * b[4],
    a[0] * b[2] + a[1] * b[5] + a[2],
    a[3] * b[0] + a[4] * b[3],
    a[3] * b[1] + a[4] * b[4],
    a[3] * b[2] + a[4] * b[5] + a[5],
  ];
}

function inv6(t: Transform6): Transform6 {
  const det = t[0] * t[4] - t[1] * t[3];
  return [
    t[4] / det,
    -t[1] / det,
    (t[1] * t[5] - t[2] * t[4]) / det,
    -t[3] / det,
    t[0] / det,
    (t[2] * t[3] - t[0] * t[5]) / det,
  ];
}

function transPt6(m: Transform6, p: Point): Point {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}

function ttrans(tx: number, ty: number): Transform6 {
  return [1, 0, tx, 0, 1, ty];
}

function trot(angle: number): Transform6 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0];
}

function rotAbout(p: Point, angle: number): Transform6 {
  return mul6(ttrans(p.x, p.y), mul6(trot(angle), ttrans(-p.x, -p.y)));
}

function matchSeg(p: Point, q: Point): Transform6 {
  return [q.x - p.x, p.y - q.y, p.x, q.y - p.y, q.x - p.x, p.y];
}

/** Compute affine transform mapping segment p1→q1 to segment p2→q2. */
function matchTwo(p1: Point, q1: Point, p2: Point, q2: Point): Transform6 {
  return mul6(matchSeg(p2, q2), inv6(matchSeg(p1, q1)));
}

function intersect(p1: Point, q1: Point, p2: Point, q2: Point): Point {
  const d =
    (q2.y - p2.y) * (q1.x - p1.x) - (q2.x - p2.x) * (q1.y - p1.y);
  const uA =
    ((q2.x - p2.x) * (p1.y - p2.y) - (q2.y - p2.y) * (p1.x - p2.x)) / d;
  return {
    x: p1.x + uA * (q1.x - p1.x),
    y: p1.y + uA * (q1.y - p1.y),
  };
}

function padd(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function psub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

// ─── Hex-grid to Cartesian ──────────────────────────────────────

/** Convert hex-grid coordinates to Cartesian: (x + y/2, (√3/2)·y). */
export function hexPt(x: number, y: number): Point {
  return { x: x + 0.5 * y, y: SQRT3_HALF * y };
}

// ─── Hat outline (13 vertices) ──────────────────────────────────

export function hatOutline(): Point[] {
  return [
    hexPt(0, 0),
    hexPt(-1, -1),
    hexPt(0, -2),
    hexPt(2, -2),
    hexPt(2, -1),
    hexPt(4, -2),
    hexPt(5, -1),
    hexPt(4, 0),
    hexPt(3, 0),
    hexPt(2, 2),
    hexPt(0, 3),
    hexPt(0, 2),
    hexPt(-1, 2),
  ];
}

// ─── Internal tile hierarchy ────────────────────────────────────

interface HatTileLeaf {
  readonly kind: 'hat';
  readonly type: 'hat' | 'hat-reflected';
}

interface MetatileNode {
  readonly kind: 'metatile';
  shape: Point[];
  children: MetatileChild[];
}

type MetatileChild = { T: Transform6; geom: HatTileLeaf | MetatileNode };

function makeHatLeaf(type: 'hat' | 'hat-reflected'): HatTileLeaf {
  return { kind: 'hat', type };
}

function makeMetatile(shape: Point[]): MetatileNode {
  return { kind: 'metatile', shape, children: [] };
}

// ─── Count hat tiles in a (meta)tile subtree ────────────────────

function countHats(node: HatTileLeaf | MetatileNode): number {
  if (node.kind === 'hat') return 1;
  let n = 0;
  for (const ch of node.children) n += countHats(ch.geom);
  return n;
}

// ─── Flatten: collect all hat tiles with composed transforms ────

function flatten(
  node: HatTileLeaf | MetatileNode,
  T: Transform6,
): { polygon: Point[]; transform: Transform6; type: 'hat' | 'hat-reflected' }[] {
  if (node.kind === 'hat') {
    return [{ polygon: hatOutline(), transform: T, type: node.type }];
  }
  const result: { polygon: Point[]; transform: Transform6; type: 'hat' | 'hat-reflected' }[] = [];
  for (const ch of node.children) {
    const composed = mul6(T, ch.T);
    result.push(...flatten(ch.geom, composed));
  }
  return result;
}

// ─── Initial metatiles (level 0) ────────────────────────────────

function createInitialMetatiles(): [MetatileNode, MetatileNode, MetatileNode, MetatileNode] {
  const H_outline: Point[] = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4.5, y: SQRT3_HALF },
    { x: 2.5, y: 5 * SQRT3_HALF }, { x: 1.5, y: 5 * SQRT3_HALF }, { x: -0.5, y: SQRT3_HALF },
  ];
  const H = makeMetatile(H_outline);
  const hatPts = hatOutline();

  
  H.children.push({ T: matchTwo(hatPts[5], hatPts[7], H_outline[5], H_outline[0]), geom: makeHatLeaf('hat') });
  H.children.push({ T: matchTwo(hatPts[9], hatPts[11], H_outline[1], H_outline[2]), geom: makeHatLeaf('hat') });
  H.children.push({ T: matchTwo(hatPts[5], hatPts[7], H_outline[3], H_outline[4]), geom: makeHatLeaf('hat') });
  H.children.push({
    T: mul6(ttrans(2.5, SQRT3_HALF), mul6(
      [-0.5, -SQRT3_HALF, 0, SQRT3_HALF, -0.5, 0] as Transform6,
      [0.5, 0, 0, 0, -0.5, 0] as Transform6,
    )),
    geom: makeHatLeaf('hat-reflected'),
  });

  
  const T_outline: Point[] = [
    { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 1.5, y: 3 * SQRT3_HALF },
  ];
  const T = makeMetatile(T_outline);
  T.children.push({ T: [0.5, 0, 0.5, 0, 0.5, SQRT3_HALF] as Transform6, geom: makeHatLeaf('hat') });

  
  const P_outline: Point[] = [
    { x: 0, y: 0 }, { x: 4, y: 0 },
    { x: 3, y: 2 * SQRT3_HALF }, { x: -1, y: 2 * SQRT3_HALF },
  ];
  const P = makeMetatile(P_outline);
  P.children.push({ T: [0.5, 0, 1.5, 0, 0.5, SQRT3_HALF] as Transform6, geom: makeHatLeaf('hat') });
  P.children.push({
    T: mul6(ttrans(0, 2 * SQRT3_HALF), mul6(
      [0.5, SQRT3_HALF, 0, -SQRT3_HALF, 0.5, 0] as Transform6,
      [0.5, 0, 0, 0, 0.5, 0] as Transform6,
    )),
    geom: makeHatLeaf('hat'),
  });

  
  const F_outline: Point[] = [
    { x: 0, y: 0 }, { x: 3, y: 0 },
    { x: 3.5, y: SQRT3_HALF }, { x: 3, y: 2 * SQRT3_HALF }, { x: -1, y: 2 * SQRT3_HALF },
  ];
  const F = makeMetatile(F_outline);
  F.children.push({ T: [0.5, 0, 1.5, 0, 0.5, SQRT3_HALF] as Transform6, geom: makeHatLeaf('hat') });
  F.children.push({
    T: mul6(ttrans(0, 2 * SQRT3_HALF), mul6(
      [0.5, SQRT3_HALF, 0, -SQRT3_HALF, 0.5, 0] as Transform6,
      [0.5, 0, 0, 0, 0.5, 0] as Transform6,
    )),
    geom: makeHatLeaf('hat'),
  });

  return [H, T, P, F];
}

// ─── constructPatch: assemble 29 metatile children ──────────────

function constructPatch(
  H: MetatileNode,
  T: MetatileNode,
  P: MetatileNode,
  F: MetatileNode,
): MetatileNode {
  // Each rule produces one child of the patch.
  // Length-1: place a metatile with identity transform.
  // Length-4: [refChild, vertexIdx, type, srcVertex] — match one edge.
  // Length-6: [refA, vertA, refB, vertB, type, srcVertex] — match two edges.
  const rules: (string | number)[][] = [
    ['H'],
    [0, 0, 'P', 2],
    [1, 0, 'H', 2],
    [2, 0, 'P', 2],
    [3, 0, 'H', 2],
    [4, 4, 'P', 2],
    [0, 4, 'F', 3],
    [2, 4, 'F', 3],
    [4, 1, 3, 2, 'F', 0],
    [8, 3, 'H', 0],
    [9, 2, 'P', 0],
    [10, 2, 'H', 0],
    [11, 4, 'P', 2],
    [12, 0, 'H', 2],
    [13, 0, 'F', 3],
    [14, 2, 'F', 1],
    [15, 3, 'H', 4],
    [8, 2, 'F', 1],
    [17, 3, 'H', 0],
    [18, 2, 'P', 0],
    [19, 2, 'H', 2],
    [20, 4, 'F', 3],
    [20, 0, 'P', 2],
    [22, 0, 'H', 2],
    [23, 4, 'F', 3],
    [23, 0, 'F', 3],
    [16, 0, 'P', 2],
    [9, 4, 0, 2, 'T', 2],
    [4, 0, 'F', 3],
  ];

  const shapes: Record<string, MetatileNode> = { H, T, P, F };
  const patch = makeMetatile([]);

  for (const r of rules) {
    if (r.length === 1) {
      patch.children.push({ T: [...IDENT_T], geom: shapes[r[0] as string] });
    } else if (r.length === 4) {
      const refIdx = r[0] as number;
      const vertIdx = r[1] as number;
      const typeKey = r[2] as string;
      const srcVert = r[3] as number;

      const refChild = patch.children[refIdx];
      const refPoly = refChild.geom.kind === 'metatile'
        ? (refChild.geom as MetatileNode).shape
        : hatOutline();
      const P_pt = transPt6(refChild.T, refPoly[(vertIdx + 1) % refPoly.length]);
      const Q_pt = transPt6(refChild.T, refPoly[vertIdx]);
      const nshp = shapes[typeKey];
      const npoly = nshp.shape;

      patch.children.push({
        T: matchTwo(npoly[srcVert], npoly[(srcVert + 1) % npoly.length], P_pt, Q_pt),
        geom: nshp,
      });
    } else {
    
      const refA = r[0] as number;
      const vertA = r[1] as number;
      const refB = r[2] as number;
      const vertB = r[3] as number;
      const typeKey = r[4] as string;
      const srcVert = r[5] as number;

      const chQ = patch.children[refB];
      const chP = patch.children[refA];

      const chQGeom = chQ.geom.kind === 'metatile'
        ? (chQ.geom as MetatileNode).shape
        : hatOutline();
      const chPGeom = chP.geom.kind === 'metatile'
        ? (chP.geom as MetatileNode).shape
        : hatOutline();

      const P_pt = transPt6(chQ.T, chQGeom[vertB]);
      const Q_pt = transPt6(chP.T, chPGeom[vertA]);
      const nshp = shapes[typeKey];
      const npoly = nshp.shape;

      patch.children.push({
        T: matchTwo(npoly[srcVert], npoly[(srcVert + 1) % npoly.length], P_pt, Q_pt),
        geom: nshp,
      });
    }
  }

  return patch;
}

// ─── constructMetatiles: extract 4 larger metatiles from patch ──

function evalChild(patch: MetatileNode, childIdx: number, vertIdx: number): Point {
  const ch = patch.children[childIdx];
  const shape = ch.geom.kind === 'metatile' ? (ch.geom as MetatileNode).shape : hatOutline();
  return transPt6(ch.T, shape[vertIdx]);
}

function recentre(node: MetatileNode): void {
  let cx = 0;
  let cy = 0;
  for (const p of node.shape) {
    cx += p.x;
    cy += p.y;
  }
  cx /= node.shape.length;
  cy /= node.shape.length;

  const tr = ttrans(-cx, -cy);
  for (let i = 0; i < node.shape.length; i++) {
    node.shape[i] = padd(node.shape[i], { x: -cx, y: -cy });
  }
  for (const ch of node.children) {
    ch.T = mul6(tr, ch.T);
  }
}

function constructMetatiles(patch: MetatileNode): [MetatileNode, MetatileNode, MetatileNode, MetatileNode] {
  const PI = Math.PI;

  const bps1 = evalChild(patch, 8, 2);
  const bps2 = evalChild(patch, 21, 2);
  const rbps = transPt6(rotAbout(bps1, -2.0 * PI / 3.0), bps2);

  const p72 = evalChild(patch, 7, 2);
  const _p252 = evalChild(patch, 25, 2);

  const llc = intersect(bps1, rbps, evalChild(patch, 6, 2), p72);
  let w = psub(evalChild(patch, 6, 2), llc);

  // ── new H ──
  const newHOutline: Point[] = [llc, bps1];
  w = transPt6(trot(-PI / 3), w);
  newHOutline.push(padd(newHOutline[1], w));
  newHOutline.push(evalChild(patch, 14, 2));
  w = transPt6(trot(-PI / 3), w);
  newHOutline.push(psub(newHOutline[3], w));
  newHOutline.push(evalChild(patch, 6, 2));

  const newH = makeMetatile(newHOutline);
  for (const ch of [0, 9, 16, 27, 26, 6, 1, 8, 10, 15]) {
    newH.children.push({ T: [...patch.children[ch].T], geom: patch.children[ch].geom });
  }

  // ── new P ──
  const newPOutline: Point[] = [p72, padd(p72, psub(bps1, llc)), bps1, llc];
  const newP = makeMetatile(newPOutline);
  for (const ch of [7, 2, 3, 4, 28]) {
    newP.children.push({ T: [...patch.children[ch].T], geom: patch.children[ch].geom });
  }

  // ── new F ──
  const p252 = evalChild(patch, 25, 2);
  const newFOutline: Point[] = [
    bps2,
    evalChild(patch, 24, 2),
    evalChild(patch, 25, 0),
    p252,
    padd(p252, psub(llc, bps1)),
  ];
  const newF = makeMetatile(newFOutline);
  for (const ch of [21, 20, 22, 23, 24, 25]) {
    newF.children.push({ T: [...patch.children[ch].T], geom: patch.children[ch].geom });
  }

  // ── new T ──
  const AAA = newHOutline[2];
  const BBB = padd(newHOutline[1], psub(newHOutline[4], newHOutline[5]));
  const CCC = transPt6(rotAbout(BBB, -PI / 3), AAA);
  const newTOutline: Point[] = [BBB, CCC, AAA];
  const newT = makeMetatile(newTOutline);
  newT.children.push({ T: [...patch.children[11].T], geom: patch.children[11].geom });

  recentre(newH);
  recentre(newP);
  recentre(newF);
  recentre(newT);

  return [newH, newT, newP, newF];
}

// ─── Public API ─────────────────────────────────────────────────

/** Convert a 6-element transform [a,b,c,d,e,f] to our 9-element AffineTransform. */
function t6toAffine(t: Transform6): transform.AffineTransform {
  return { matrix: [t[0], t[1], t[2], t[3], t[4], t[5], 0, 0, 1] };
}

/**
 * Generate an einstein hat tiling via the 4-metatile substitution system.
 *
 * @param width   Bounding width for filtering output tiles
 * @param height  Bounding height for filtering output tiles
 * @param depth   Number of substitution rounds (0 = initial metatiles, 1+ = increasingly large)
 * @returns Array of Tile objects within the bounding region
 */
export function generateHatTiling(
  width: number,
  height: number,
  depth: number,
): Tile[] {
  let metatiles = createInitialMetatiles();
  const [H0] = metatiles;


  for (let round = 0; round < depth; round++) {
    const patch = constructPatch(metatiles[0], metatiles[1], metatiles[2], metatiles[3]);
    metatiles = constructMetatiles(patch);
  }


  const root = metatiles[0];


  const rawTiles = flatten(root, [...IDENT_T]);


  const halfW = width / 2;
  const halfH = height / 2;
  const result: Tile[] = [];

  for (const raw of rawTiles) {
    const affine = t6toAffine(raw.transform);
    const poly = polygon.create(raw.polygon);
    const transformed = transform.applyToPolygon(affine, poly);
    const bb = polygon.boundingBox(transformed);

    if (bb.max.x < -halfW || bb.min.x > halfW) continue;
    if (bb.max.y < -halfH || bb.min.y > halfH) continue;

    result.push({
      polygon: poly,
      transform: affine,
      type: raw.type,
    });
  }

  return result;
}

/**
 * Get the initial metatile outlines (for testing/debugging).
 * Returns [H, T, P, F] metatile shapes.
 */
export function getInitialMetatileShapes(): { type: string; outline: Point[]; childCount: number }[] {
  const [H, T, P, F] = createInitialMetatiles();
  return [
    { type: 'H', outline: H.shape, childCount: H.children.length },
    { type: 'T', outline: T.shape, childCount: T.children.length },
    { type: 'P', outline: P.shape, childCount: P.children.length },
    { type: 'F', outline: F.shape, childCount: F.children.length },
  ];
}

/**
 * Perform one round of substitution and return the new metatile hierarchy.
 * Useful for testing the substitution engine.
 */
export function performSubstitution(): {
  patchChildCount: number;
  metatileShapes: { type: string; outline: Point[]; childCount: number }[];
  totalHatCount: number;
} {
  const metatiles = createInitialMetatiles();
  const patch = constructPatch(metatiles[0], metatiles[1], metatiles[2], metatiles[3]);
  const [newH, newT, newP, newF] = constructMetatiles(patch);

  return {
    patchChildCount: patch.children.length,
    metatileShapes: [
      { type: 'H', outline: newH.shape, childCount: newH.children.length },
      { type: 'T', outline: newT.shape, childCount: newT.children.length },
      { type: 'P', outline: newP.shape, childCount: newP.children.length },
      { type: 'F', outline: newF.shape, childCount: newF.children.length },
    ],
    totalHatCount: countHats(newH) + countHats(newT) + countHats(newP) + countHats(newF),
  };
}

/**
 * Count total hat tiles in the H metatile after N substitution rounds.
 */
export function countHatsAfterSubstitution(rounds: number): number {
  let metatiles = createInitialMetatiles();
  for (let i = 0; i < rounds; i++) {
    const patch = constructPatch(metatiles[0], metatiles[1], metatiles[2], metatiles[3]);
    metatiles = constructMetatiles(patch);
  }

  return metatiles.reduce((sum, m) => sum + countHats(m), 0);
}
