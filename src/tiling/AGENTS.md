# Tiling Module

## Purpose
Aperiodic monotile tiling generation (Spectre and Hat), curved edge decoration, and the continuous Tile(q,b) shape family.

## Files
| File | Lines | Role |
|---|---|---|
| `spectre.ts` | 203 | Spectre tiling via metatile substitution rules |
| `hat.ts` | 555 | Hat tiling generation + hat tile outline geometry |
| `curved.ts` | 255 | `CurvyShape` — Bezier curve decoration on polygon edges |
| `shape-param.ts` | 74 | `generateTileVertices(q, b)` — continuous family Tile(q,b) parameterization |

## Tiling Algorithms

### Spectre Tiling (`spectre.ts`)
1. **Base tile**: `SPECTRE_VERTICES` — 14 vertices defining the Spectre shape
2. **Metatile system**: 9 metatile types (`Gamma`, `Delta`, `Theta`, `Lambda`, `Xi`, `Pi`, `Sigma`, `Phi`, `Psi`) with substitution rules in `SUPER_RULES`
3. **Generation**: `generateSpectreTiling(depth)` → build metatile tree → flatten to individual tiles
4. Key exports: `Tile` interface, `buildSupertiles()`, `flattenTiles()`, `generateSpectreTiling()`

### Hat Tiling (`hat.ts`)
- Similar metatile substitution approach for the Hat aperiodic monotile
- `hatOutline()` returns the canonical 13-vertex hat polygon
- `generateHatTiling(depth)` → tile array

### Continuous Family (`shape-param.ts`)
- `generateTileVertices(q: number, b: number)` — interpolates between Hat (b=√3) and Spectre (b=1)
- Uses shared edge angle sequence `EDGE_ANGLES` (14 angles)
- `q` controls edge-length parameter, `b` controls the "bulge" parameter

## Curved Edges (`curved.ts`)
```typescript
interface CurvyShape {
  segments: readonly BezierSegment[];
  originalPolygon: Polygon;
  straighten(): Polygon;
  toCanvasPath(ctx: CanvasRenderingContext2D): void;
}
```
- `createCurvyShape(poly)` — auto-generates alternating-direction Bezier curves on each edge
- `createCurvyShapeFromCurve(poly, curveData)` — uses explicit curve control points
- `catmullRomToBezierSegments(points)` — Catmull-Rom → cubic Bezier conversion
- Curve offset: `CURVE_OFFSET = 0.6` (alternating ± perpendicular to edge)

## Key Types
```typescript
interface Tile {
  id: number;
  polygon: Polygon;
  transform: AffineTransform;
  type: string;
  children?: Tile[];
}

type MetatileType = 'Gamma' | 'Delta' | 'Theta' | 'Lambda' | 'Xi' | 'Pi' | 'Sigma' | 'Phi' | 'Psi';

interface BezierSegment {
  from: Point; cp1: Point; cp2: Point; to: Point;
}

interface EdgeCurveData {
  // Custom curve control points for user-defined edge shapes
}
```

## Dependencies
- `../geometry/` — point, polygon, transform
