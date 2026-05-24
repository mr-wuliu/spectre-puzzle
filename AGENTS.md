# Spectre Puzzle

## Overview
A purely static web app for creating and solving jigsaw-like puzzles based on **aperiodic monotiles** (Hat and Spectre tiles from the Einstein problem). Zero runtime dependencies. Built with Vite 8 + TypeScript 6 (strict, ES2022).

## Architecture
Multi-page app with 3 HTML entry points served by Vite:
- `index.html` → `src/pages/home.ts` — Landing page with create/solve cards
- `create.html` → `src/pages/create.ts` — Tiling editor + puzzle creation (1022 lines)
- `solve.html` → `src/pages/solve.ts` — Puzzle solver with drag/snap/rotate (2202 lines)

Data flows **create → JSON export → solve**: the create page generates a puzzle JSON, the solve page imports it via file picker or localStorage.

## Key Directories
| Directory | Purpose | Lines | Key Files |
|---|---|---|---|
| `src/tiling/` | Spectre/Hat tiling generation, curved edges, shape parameterization | ~1500 | spectre.ts, hat.ts, curved.ts |
| `src/puzzle/` | Puzzle model, piece logic, snap, win detection, serialization | ~1200 | puzzle-model.ts, piece.ts, serialize.ts |
| `src/pages/` | Page-level app logic (canvas rendering, event handling, UI state) | ~4000 | solve.ts, create.ts, home.ts |
| `src/geometry/` | Vector math, polygon ops, affine transforms, Sutherland-Hodgman clipping | ~600 | point.ts, polygon.ts, transform.ts, clip.ts |
| `src/render/` | Scene transform, tile caching, animation tweening, PNG export | ~800 | renderer.ts, tile-renderer.ts, animation.ts |
| `src/interaction/` | Pointer drag, marquee selection, rotation gesture | ~400 | drag-handler.ts, marquee.ts, rotate-handler.ts |
| `src/ui/` | Curve editor widget, piece tray | ~900 | curve-editor.ts, piece-tray.ts |
| `src/styles/` | CSS (cardboard, create, home, solve, layout, curve-editor) | ~300 | *.css |
| `functions/` | CF Pages middleware (301 redirect to custom domain) | ~15 | _middleware.ts |

## Build & Dev
```bash
npm run dev          # Vite dev server on :4487
npm run build        # tsc --noEmit && vite build → dist/
npm run test         # vitest run (jsdom env)
npm run test:watch   # vitest --watch
```
**WARNING**: `npm run deploy` is misleading — it runs local preview, NOT actual deployment.

## Deployment
- **Platform**: Cloudflare Pages (project: `spectre-puzzle`)
- **Custom domain**: `puzzle.game.mrwuliu.top` (CNAME → `spectre-puzzle.pages.dev`)
- **CI**: GitHub Actions on `release: published` → `npm ci && npm run build` → `wrangler pages deploy`
- **Repo**: https://github.com/mr-wuliu/spectre-puzzle (public)
- **Release flow**: `git tag v1.x.x && git push origin v1.x.x` → create GitHub Release → auto-deploy

## Code Conventions
- **Zero runtime deps** — everything is hand-written TypeScript
- **Functional style** — modules export functions (not classes), except `DragHandler`, `RotateHandler`, `AnimationManager`, `CurveEditor`
- **Immutable data** — interfaces use `readonly`, transforms return new objects
- **Import style** — `import type { X }` for types, `import * as mod` for namespaces
- **Module namespace imports** — geometry/render modules imported as `point`, `polygon`, `transform`, etc.

## Testing
- Vitest with jsdom environment
- Tests co-located: `*.test.ts` alongside source files
- Key test files: `integration.test.ts` (890 lines), `serialize.test.ts` (514 lines)
- No CI test gate — tests only run locally
