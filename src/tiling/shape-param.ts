import type { Point } from '../geometry/point';
import { hatOutline } from './hat';
import { SPECTRE_VERTICES } from './spectre';

const SQRT3 = Math.sqrt(3);

/**
 * The 14 edge angles (radians) of the Tile(1,b) family.
 * Both Hat (b=√3) and Spectre (b=1) share this angle sequence.
 * Walking from the origin at these angles with appropriate edge
 * lengths produces every member of the continuous family.
 */
const EDGE_ANGLES: readonly number[] = [
  0,                    // 0°
  -Math.PI / 3,         // -60°
  Math.PI / 6,          // 30°
  Math.PI / 2,          // 90°
  0,                    // 0°
  Math.PI / 3,          // 60°
  5 * Math.PI / 6,      // 150°
  7 * Math.PI / 6,      // 210°
  2 * Math.PI / 3,      // 120°
  Math.PI,              // 180°
  Math.PI,              // 180°
  4 * Math.PI / 3,      // 240°
  11 * Math.PI / 6,     // 330°
  3 * Math.PI / 2,      // 270°
];

/**
 * Type-b edge indices in the 14-edge walk.
 * Type-b edges have length √3 in the Hat and length 1 in the Spectre.
 * Type-a edges (the remaining 8) always have length 1.
 *
 * The direction-vector sum of these 6 edges is (0,0), which (combined
 * with the full 14-edge sum also being (0,0)) guarantees the polygon
 * closes for every b/a ratio.
 */
const TYPE_B: ReadonlySet<number> = new Set([2, 3, 6, 7, 12, 13]);

const NUM_EDGES = 14;

function edgeWalk(t: number): Point[] {
  const bLen = SQRT3 * (1 - t) + t;
  const vertices: Point[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;

  for (let i = 0; i < NUM_EDGES; i++) {
    const len = TYPE_B.has(i) ? bLen : 1;
    const angle = EDGE_ANGLES[i];
    x += len * Math.cos(angle);
    y += len * Math.sin(angle);
    if (i < NUM_EDGES - 1) {
      vertices.push({ x, y });
    }
  }

  return vertices;
}

export function generateTileVertices(param: number): Point[] {
  const t = Math.max(0, Math.min(1, param));

  if (t === 0) {
    return hatOutline();
  }

  if (t === 1) {
    return SPECTRE_VERTICES.map(v => ({ x: v.x, y: v.y }));
  }

  return edgeWalk(t);
}
