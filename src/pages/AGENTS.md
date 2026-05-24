# Pages Module

## Purpose
Page-level application logic: canvas rendering, pointer event handling, UI state management. These are the largest and most complex files in the project.

## Files
| File | Lines | Role |
|---|---|---|
| `home.ts` | 87 | Landing page: creates card UI linking to create.html and solve.html. Minimal logic. |
| `create.ts` | 1022 | Tiling editor: generate Hat/Spectre tilings, select region, apply curved edges, export puzzle JSON |
| `solve.ts` | 2202 | Puzzle solver: import puzzle JSON, drag/rotate/snap pieces, multi-piece selection, tray, win detection, animations |

## Page: create.ts

### State (`EditorState`)
```typescript
{
  tiles: AnyTile[];              // generated tiling tiles
  selectedIndices: Set<number>;  // selected tile indices
  curvyShapes: Map<number, CurvyShape>;
  scene: SceneTransform;         // pan/zoom/rotation
  mode: 'pan' | 'select';
  marqueeState: MarqueeState | null;
  selectionRect: SelectionFrame | null;
  tileType: 'hat' | 'spectre';
  depth: number;                 // tiling recursion depth
  curvedEdges: boolean;
  shapeParam: number;            // Tile(q,b) family parameter
  customCurveData: EdgeCurveData | null;
}
```

### Key Functions
- Tiling generation via `spectreTiling.generateSpectreTiling()` or `hatTiling.generateHatTiling()`
- Region selection with marquee → clip tiles to selection rect → create pieces with side IDs
- `hashEdgeMidpoint()` — deterministic side ID generation from shared edge midpoints
- Export: `downloadPuzzleJSON()` / `savePuzzleLocal()`

### Canvas Interactions
- Pan (drag in pan mode), select (marquee), resize selection handles
- Shape param slider, curved edges toggle, depth control

## Page: solve.ts (THE BEAST — 2202 lines)

### State (module-level variables, not class)
```typescript
let puzzle: PuzzleModel | null;
let sceneXform: SceneTransform;
let dragInfo: DragInfo | null;          // piece drag state
let rotateDragInfo: RotateDragInfo | null;
let marqueeInfo: MarqueeInfo | null;
let selectedPieceIds: Set<number>;
let selectionFrame: SelectionFrame | null;
let selectedTrayPieceKind: TrayPieceKind | null;
let won: boolean;
let hoveredPieceId: number | null;
let pieceColorMap: Map<number, {fill, stroke}>;
let curvedEdges: boolean;
```

### Key Constants
```typescript
SOLVE_SNAP_THRESHOLD = 0.2;           // scene-space snap distance
SOLVE_SNAP_ANGLE_THRESHOLD = π/18;    // 10° angle tolerance
SOLVE_SNAP_GEOMETRIC_MATCH = true;
TRASH_ZONE_SIZE = 64;                  // bottom-right delete zone
```

### Canvas Interactions
- **Drag**: pointer down on piece → track offset → move → snap on release
- **Rotate**: Alt+drag or dedicated rotate handle → rotate piece/group
- **Marquee**: shift+drag → multi-select pieces inside rect
- **Selection frame**: drag/rotate selected group as unit
- **Tray**: bottom panel with piece thumbnails; click to pick up chiral variant
- **Trash zone**: drag piece to bottom-right corner → detach from puzzle

### Rendering Pipeline
1. Clear canvas
2. Draw frame outline
3. Draw placed pieces (transformed polygons with colors)
4. Draw tray (thumbnail pieces)
5. Draw selection frame overlay
6. Draw marquee rect
7. Draw trash zone indicator
8. Draw snap preview (ghost outline when near snap target)

### Win Flow
`checkWinCondition(model)` → `WinResult` → if `isComplete` → celebration animation

### Puzzle Import
- File picker (`.json`) → `importPuzzle(text)` → `PuzzleModel`
- localStorage saved puzzles list → `loadSavedPuzzle(key)` → `PuzzleModel`

## Dependencies
- `../puzzle/*` — full puzzle domain (model, piece, snap, win, serialize)
- `../geometry/*` — point, polygon, transform, clip
- `../tiling/*` — spectre, hat, curved, shape-param
- `../render/*` — renderer, animation
- `../interaction/*` — marquee
- `../ui/*` — curve-editor (create page only)
