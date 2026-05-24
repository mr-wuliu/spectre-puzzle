# Render Module

## Purpose
Canvas 2D rendering pipeline: scene transforms, tile caching, animation tweening, image export.

## Files
| File | Lines | Role |
|---|---|---|
| `renderer.ts` | 125 | Scene transform (pan/zoom/rotation), screen↔scene coordinate conversion |
| `tile-renderer.ts` | 159 | Offscreen tile caching (`TileCacheEntry`), dirty region tracking, batch rendering |
| `animation.ts` | 249 | Tweening engine with easing functions, `AnimationManager` class, reduced-motion support |
| `image-export.ts` | 99 | PNG export via Canvas `toBlob()` with high-res scale multiplier |

## Scene Transform (`renderer.ts`)
```typescript
interface SceneTransform {
  panX, panY: number;     // world offset
  zoom: number;           // scale factor
  rotation: number;       // radians
  centerX, centerY: number; // rotation pivot
}
```
- `sceneToScreen(transform, x, y)` → Point — world → pixel coords
- `screenToScene(transform, x, y)` → Point — pixel → world coords
- `applyToCtx(transform, ctx)` — applies transform to Canvas2D context
- Immutable: `withPan`, `withZoom`, `withRotation` return new objects

## Tile Caching (`tile-renderer.ts`)
```typescript
interface TileCacheEntry {
  polygon: Polygon;
  fillColor, strokeColor: string;
  bbox: { min: Point; max: Point };
  canvas: OffscreenCanvas | null;  // pre-rendered tile
  path: Path2D;                     // cached path for hit testing
}
```
- `createTileCacheEntry()` — pre-renders tile to OffscreenCanvas for fast drawing
- `DirtyTracker` — tracks damaged regions for partial redraws
- `polygonToPath2D()` — converts Polygon → Path2D for Canvas API

## Animation (`animation.ts`)
- Easing functions: `easeInOutCubic`, `easeOutBack`, `easeOutCubic`
- `AnimationManager` class — manages active tweens, frame scheduling via `requestAnimationFrame`
- `tween(target, props, duration, easing)` → `AnimationHandle { cancel(), promise, done }`
- Respects `prefers-reduced-motion` — skips animation if enabled
- Spring physics: `spring(target, props, stiffness, damping)` → spring-based motion

## Image Export (`image-export.ts`)
- `exportAsPNG(canvas, width?, height?, scale=1)` → `Promise<Blob>`
- Uses OffscreenCanvas for high-res export (2x, 3x retina)
- Fallback to regular canvas when OffscreenCanvas unavailable

## Dependencies
- `../geometry/` — point, polygon
