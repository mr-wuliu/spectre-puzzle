import type { Point } from '../geometry/point';
import type { Polygon } from '../geometry/polygon';
import type { AffineTransform } from '../geometry/transform';
import * as point from '../geometry/point';
import * as polygon from '../geometry/polygon';
import * as transform from '../geometry/transform';

const SQRT3_HALF = Math.sqrt(3) / 2;

export const SPECTRE_VERTICES: readonly Point[] = Object.freeze([
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
]);

const SPECTRE_QUAD: readonly Point[] = [
  SPECTRE_VERTICES[3], SPECTRE_VERTICES[5],
  SPECTRE_VERTICES[7], SPECTRE_VERTICES[11],
];

export type MetatileType = 'Gamma' | 'Delta' | 'Theta' | 'Lambda' | 'Xi' | 'Pi' | 'Sigma' | 'Phi' | 'Psi';

export const METATILE_TYPES: readonly MetatileType[] = [
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi',
];

export const SUPER_RULES: Readonly<Record<MetatileType, readonly (MetatileType | null)[]>> = {
  Gamma:  ['Pi', 'Delta', null, 'Theta', 'Sigma', 'Xi', 'Phi', 'Gamma'],
  Delta:  ['Xi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
  Theta:  ['Psi', 'Delta', 'Pi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
  Lambda: ['Psi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
  Xi:     ['Psi', 'Delta', 'Pi', 'Phi', 'Sigma', 'Psi', 'Phi', 'Gamma'],
  Pi:     ['Psi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Psi', 'Phi', 'Gamma'],
  Sigma:  ['Xi', 'Delta', 'Xi', 'Phi', 'Sigma', 'Pi', 'Lambda', 'Gamma'],
  Phi:    ['Psi', 'Delta', 'Psi', 'Phi', 'Sigma', 'Pi', 'Phi', 'Gamma'],
  Psi:    ['Psi', 'Delta', 'Psi', 'Phi', 'Sigma', 'Psi', 'Phi', 'Gamma'],
};

export interface Tile {
  polygon: Polygon;
  transform: AffineTransform;
  type: 'spectre';
}

export interface MetatileLeaf {
  readonly kind: 'leaf';
  readonly vertices: readonly Point[];
  readonly quad: readonly Point[];
  readonly label: string;
}

export interface MetatileComposite {
  readonly kind: 'composite';
  readonly children: readonly { node: MetatileNode; xform: AffineTransform }[];
  readonly quad: readonly Point[];
  readonly label: string;
}

export type MetatileNode = MetatileLeaf | MetatileComposite;

const T_RULES: readonly (readonly [number, number, number])[] = [
  [60, 3, 1], [0, 2, 0], [60, 3, 1], [60, 3, 1],
  [0, 2, 0], [60, 3, 1], [-120, 3, 3],
];

const R: AffineTransform = { matrix: [-1, 0, 0, 0, 1, 0, 0, 0, 1] };

function degToRad(deg: number): number {
  return deg * Math.PI / 180;
}

export function buildSpectreBase(): Record<string, MetatileNode> {
  const result: Record<string, MetatileNode> = {};

  const simpleTypes: MetatileType[] = ['Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi'];
  for (const label of simpleTypes) {
    result[label] = { kind: 'leaf', vertices: SPECTRE_VERTICES, quad: SPECTRE_QUAD, label };
  }

  const v8 = SPECTRE_VERTICES[8];
  const gammaChildXform = transform.compose(
    transform.translation(v8.x, v8.y),
    transform.rotation(Math.PI / 6),
  );

  result['Gamma'] = {
    kind: 'composite',
    children: [
      {
        node: { kind: 'leaf', vertices: SPECTRE_VERTICES, quad: SPECTRE_QUAD, label: 'Gamma1' },
        xform: transform.identity(),
      },
      {
        node: { kind: 'leaf', vertices: SPECTRE_VERTICES, quad: SPECTRE_QUAD, label: 'Gamma2' },
        xform: gammaChildXform,
      },
    ],
    quad: SPECTRE_QUAD,
    label: 'Gamma',
  };

  return result;
}

export function buildSupertiles(sys: Record<string, MetatileNode>): Record<string, MetatileNode> {
  const quad = sys['Delta'].quad;

  const Ts: AffineTransform[] = [transform.identity()];
  let totalAng = 0;
  let rot = transform.identity();
  const tquad: Point[] = [quad[0], quad[1], quad[2], quad[3]];

  for (const [angDeg, from, to] of T_RULES) {
    totalAng += angDeg;
    if (angDeg !== 0) {
      rot = transform.rotation(degToRad(totalAng));
      for (let i = 0; i < 4; ++i) {
        tquad[i] = transform.applyToPoint(rot, quad[i]);
      }
    }
    const prevMapped = transform.applyToPoint(Ts[Ts.length - 1], quad[from]);
    const ttt = transform.translation(
      prevMapped.x - tquad[to].x,
      prevMapped.y - tquad[to].y,
    );
    Ts.push(transform.compose(ttt, rot));
  }

  for (let idx = 0; idx < Ts.length; ++idx) {
    Ts[idx] = transform.compose(R, Ts[idx]);
  }

  const superQuad: Point[] = [
    transform.applyToPoint(Ts[6], quad[2]),
    transform.applyToPoint(Ts[5], quad[1]),
    transform.applyToPoint(Ts[3], quad[2]),
    transform.applyToPoint(Ts[0], quad[1]),
  ];

  const result: Record<string, MetatileNode> = {};

  for (const type of METATILE_TYPES) {
    const rules = SUPER_RULES[type];
    const children: { node: MetatileNode; xform: AffineTransform }[] = [];

    for (let idx = 0; idx < 8; ++idx) {
      const childType = rules[idx];
      if (childType === null) continue;
      children.push({ node: sys[childType], xform: Ts[idx] });
    }

    result[type] = {
      kind: 'composite',
      children,
      quad: superQuad,
      label: type,
    };
  }

  return result;
}

export function flattenTiles(node: MetatileNode, xform: AffineTransform): Tile[] {
  if (node.kind === 'leaf') {
    return [{
      polygon: polygon.create(node.vertices.map(v => ({ x: v.x, y: v.y }))),
      transform: xform,
      type: 'spectre',
    }];
  }

  const tiles: Tile[] = [];
  for (const child of node.children) {
    const childXform = transform.compose(xform, child.xform);
    tiles.push(...flattenTiles(child.node, childXform));
  }
  return tiles;
}

export function getSpectreVertices(): Point[] {
  return SPECTRE_VERTICES.map(v => ({ x: v.x, y: v.y }));
}

export function generateSpectreTiling(width: number, height: number, depth: number): Tile[] {
  let sys = buildSpectreBase();
  for (let i = 0; i < depth; i++) {
    sys = buildSupertiles(sys);
  }

  const startNode = sys['Delta'];
  return flattenTiles(startNode, transform.identity());
}
