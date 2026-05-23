import type { Piece } from '../puzzle/piece';
import type { Polygon } from '../geometry/polygon';
import * as polygon from '../geometry/polygon';

// ── Public callback types ────────────────────────────────────────

export interface PieceTrayCallbacks {
  onPieceSelect: (pieceId: number) => void;
  onPieceDragStart?: (pieceId: number, event: PointerEvent) => void;
}

// ── Constants ────────────────────────────────────────────────────

const THUMBNAIL_SIZE = 80;
const THUMBNAIL_PADDING = 8;

// ── Color helpers ────────────────────────────────────────────────

function pieceColors(id: number): { fill: string; stroke: string } {
  const hue = ((id * 47 + 30) % 360 + 360) % 360;
  return {
    fill: `hsla(${hue}, 45%, 60%, 0.45)`,
    stroke: `hsla(${hue}, 55%, 40%, 0.85)`,
  };
}

// ── Thumbnail rendering ──────────────────────────────────────────

function renderThumbnail(
  canvas: HTMLCanvasElement,
  poly: Polygon,
  pieceId: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = THUMBNAIL_SIZE;
  ctx.clearRect(0, 0, size, size);

  const bbox = polygon.boundingBox(poly);
  const pw = bbox.max.x - bbox.min.x;
  const ph = bbox.max.y - bbox.min.y;
  if (pw <= 0 || ph <= 0) return;

  const s = Math.min(
    (size - THUMBNAIL_PADDING) / pw,
    (size - THUMBNAIL_PADDING) / ph,
  );
  const ox = (size - pw * s) / 2 - bbox.min.x * s;
  const oy = (size - ph * s) / 2 - bbox.min.y * s;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);

  const verts = poly.vertices;
  const path = new Path2D();
  path.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    path.lineTo(verts[i].x, verts[i].y);
  }
  path.closePath();

  const colors = pieceColors(pieceId);
  ctx.fillStyle = colors.fill;
  ctx.fill(path);
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 1.5 / s;
  ctx.stroke(path);
  ctx.restore();
}

// ── PieceTray class ──────────────────────────────────────────────

export class PieceTray {
  private readonly callbacks: PieceTrayCallbacks;

  private readonly headerEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly trayGrid: HTMLElement;

  private pieceCards = new Map<number, HTMLElement>();
  private highlightedIds = new Set<number>();
  private selectedId: number | null = null;

  constructor(container: HTMLElement, callbacks: PieceTrayCallbacks) {
    this.callbacks = callbacks;

    Object.assign(container.style, {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    });

    // ── Header with count badge ──
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'tray-header';
    Object.assign(this.headerEl.style, {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      flexShrink: '0',
    });

    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Pieces';

    this.countEl = document.createElement('span');
    this.countEl.className = 'tray-count';
    this.countEl.textContent = '0 / 0 placed';

    this.headerEl.appendChild(titleSpan);
    this.headerEl.appendChild(this.countEl);
    container.appendChild(this.headerEl);

    // ── Scrollable grid ──
    this.trayGrid = document.createElement('div');
    this.trayGrid.id = 'piece-tray';
    Object.assign(this.trayGrid.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--spacing-sm, 8px)',
      alignContent: 'flex-start',
      overflowY: 'auto',
      flex: '1 1 auto',
      padding: 'var(--spacing-xs, 4px)',
    });
    container.appendChild(this.trayGrid);
  }

  // ── Render unplaced pieces ────────────────────────────────────

  render(pieces: Piece[]): void {
    this.trayGrid.innerHTML = '';
    this.pieceCards.clear();

    const unplaced = pieces.filter((p) => !p.isPlaced);
    const placed = pieces.length - unplaced.length;
    this.updateCount(placed, pieces.length);

    for (const piece of unplaced) {
      const card = this.createCard(piece);
      this.pieceCards.set(piece.id, card);
      this.trayGrid.appendChild(card);
    }
  }

  // ── Count badge update ────────────────────────────────────────

  updateCount(placed: number, total: number): void {
    this.countEl.textContent = `${placed} / ${total} placed`;
  }

  // ── Highlight / clear ─────────────────────────────────────────

  highlightPiece(pieceId: number): void {
    this.highlightedIds.add(pieceId);
    const card = this.pieceCards.get(pieceId);
    if (card) {
      card.style.borderColor = 'var(--color-accent, #8b6914)';
      card.style.boxShadow = '0 0 0 2px rgba(139, 105, 20, 0.4)';
    }
  }

  clearHighlights(): void {
    for (const id of this.highlightedIds) {
      const card = this.pieceCards.get(id);
      if (card && this.selectedId !== id) {
        card.style.borderColor = 'transparent';
        card.style.boxShadow = 'none';
      }
    }
    this.highlightedIds.clear();
  }

  // ── Private helpers ───────────────────────────────────────────

  private createCard(piece: Piece): HTMLElement {
    const card = document.createElement('div');
    card.className = 'tray-piece';
    card.dataset.pieceId = String(piece.id);

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = THUMBNAIL_SIZE;
    thumbCanvas.height = THUMBNAIL_SIZE;
    renderThumbnail(thumbCanvas, piece.polygon, piece.id);

    const label = document.createElement('span');
    label.className = 'tray-label';
    label.textContent = `#${piece.id}`;

    card.appendChild(thumbCanvas);
    card.appendChild(label);

    card.addEventListener('click', () => {
      this.selectPiece(piece.id);
    });

    if (this.selectedId === piece.id) {
      card.classList.add('selected');
    }
    if (this.highlightedIds.has(piece.id)) {
      card.style.borderColor = 'var(--color-accent, #8b6914)';
      card.style.boxShadow = '0 0 0 2px rgba(139, 105, 20, 0.4)';
    }

    return card;
  }

  private selectPiece(pieceId: number): void {
    if (this.selectedId !== null) {
      const prevCard = this.pieceCards.get(this.selectedId);
      if (prevCard) {
        prevCard.classList.remove('selected');
      }
    }

    if (this.selectedId === pieceId) {
      this.selectedId = null;
    } else {
      this.selectedId = pieceId;
      const card = this.pieceCards.get(pieceId);
      if (card) {
        card.classList.add('selected');
      }
    }

    this.callbacks.onPieceSelect(pieceId);
  }
}
