# Puzzle Domain Module

## Purpose
Core puzzle data model and game logic: pieces, snapping, win detection, serialization.

## Data Flow
```
createPuzzleModel(pieces, framePolygon, solutionMap, frameTilePolygons, curvedEdges, curveData)
  → PuzzleModel { pieces, framePolygon, frameTilePolygons, solutionMap, curvedEdges, curveData }
    → findSnapTarget(piece, puzzle) → SnapResult | null
    → applySnap(snap, puzzle, newId) → PuzzleModel
    → mergePieces(pieceA, pieceB, ...) → Piece
    → checkWinCondition(model) → WinResult
```

## Files
| File | Lines | Role |
|---|---|---|
| `puzzle-model.ts` | 49 | `PuzzleModel` interface + `createPuzzleModel`, `checkWin` (simple), `getPieceAt` (hit test) |
| `piece.ts` | 256 | `Piece`, `Side`, `SnapResult` interfaces; `createPiece`, `canSnapTo`, `mergePieces`, `traceBoundary`, `matchSidesToPoly` |
| `snap.ts` | 107 | `findSnapTarget` — iterates all pieces to find best snap; `applySnap` — merges two pieces |
| `win.ts` | 251 | `checkWinCondition` → `WinResult` (allPlaced, areaMatch, solutionMatch, noOverlaps, allInsideFrame); `SolutionRevealer` class |
| `serialize.ts` | 377 | JSON import/export: `importPuzzle`, `exportPuzzleJSON`, `downloadPuzzleJSON`, `savePuzzleLocal`, `listSavedPuzzles`, `loadSavedPuzzle`, `deleteSavedPuzzle` |

## Key Interfaces
```typescript
interface Piece {
  id: number;
  polygon: Polygon;          // local-space shape
  transform: AffineTransform; // local→world
  sides: Side[];              // edges with snap IDs
  isPlaced: boolean;
  isFramePiece: boolean;
}

interface Side {
  id: number;        // shared side ID = snap compatibility
  ptA: Point;        // local-space edge start
  ptB: Point;        // local-space edge end
  attachable: boolean;
}

interface SnapResult {
  pieceA: Piece; pieceB: Piece;
  sideA: Side; sideB: Side;
  offset: Point;
  adjustedTransform?: AffineTransform;
  distance?: number;
}

interface PuzzleModel {
  pieces: Piece[];
  framePolygon: Polygon;
  frameTilePolygons: Polygon[];
  solutionMap: Map<number, AffineTransform>;
  curvedEdges: boolean;
  curveData: EdgeCurveData | null;
}
```

## Snap Algorithm
1. `findSnapTarget(piece, puzzle, threshold, angleThreshold, allowGeometricMatch)` — O(n) scan of all pieces
2. For each candidate: `canSnapTo` checks side ID matching + proximity + angle alignment
3. Best snap wins (smallest distance)
4. `applySnap` → `mergePieces` combines two pieces into one (union polygon, merged sides)

## Serialization Format
```json
{
  "version": "1",
  "frame": { "vertices": [{"x":0,"y":0},...] },
  "frameTiles": [{ "vertices": [...] }],
  "pieces": [{ "id":1, "polygon":{...}, "initialTransform":{...}, "sideIds":[...], "isFramePiece":false }],
  "solution": [{ "id":1, "transform":{...} }],
  "tileType": "spectre" | "hat",
  "curvedEdges": false,
  "curveData": null | EdgeCurveData
}
```

## Dependencies
- `../geometry/` — point, polygon, transform
- `../tiling/curved` — `EdgeCurveData`, `BezierSegment` types
