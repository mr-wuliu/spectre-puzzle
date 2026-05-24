# Geometry Module

## Purpose
Low-level 2D math primitives: vectors, polygons, affine transforms, polygon clipping. Zero dependencies (no external math libs). Used by every other module.

## Files
| File | Lines | Role |
|---|---|---|
| `point.ts` | 63 | 2D vector operations on `{x, y}` |
| `polygon.ts` | 137 | Polygon geometry: area, centroid, bounding box, containment, edge iteration |
| `transform.ts` | 79 | 3×3 affine transform (translation, rotation, scaling, composition) |
| `clip.ts` | 91 | Sutherland-Hodgman polygon clipping against axis-aligned rects |

## Core Interfaces

```typescript
// point.ts
interface Point { x: number; y: number; }
// Functions: create, add, subtract, scale, rotate, rotateAround, distance, dot, cross, lerp, normalize, magnitude

// polygon.ts
interface Polygon { readonly vertices: readonly Point[]; }
// Functions: create, numVertices, clone, area (shoelace), centroid, boundingBox, containsPoint (ray casting),
//            edges, edgeLengths, perimeter, isConvex, transform

// transform.ts
interface AffineTransform {
  readonly matrix: readonly [number, number, number, number, number, number, number, number, number];
}
// Functions: identity, translation, rotation, scaling, compose, inverse, applyToPoint, applyToPolygon

// clip.ts
interface ClipRect { readonly minX, minY, maxX, maxY: number; }
// Functions: clipPolygon(polygon, rect) → Polygon, isEmptyPolygon(polygon) → boolean
```

## Conventions
- All geometry is 2D (x, y). No 3D.
- Polygons are simple (non-self-intersecting), vertices in order (CW or CCW).
- Area uses the shoelace formula — sign indicates winding direction.
- Transforms are 3×3 matrices stored as flat 9-element tuples (row-major).
- `containsPoint` uses ray casting algorithm.
- Clipping uses Sutherland-Hodgman with `EPSILON = 1e-10` tolerance.

## Performance Notes
- All functions are pure (no mutation, no side effects).
- Small allocations — Point/Polygon objects created freely.
- No spatial indexing — `getPieceAt` does O(n) point-in-polygon tests.
