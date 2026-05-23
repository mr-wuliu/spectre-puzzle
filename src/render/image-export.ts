/**
 * PNG image export for completed puzzles and canvas views.
 *
 * Uses native Canvas `toBlob()` API. Supports high-res export via
 * an optional scale multiplier (2x, 3x, etc.) using OffscreenCanvas
 * where available, with fallback to a regular canvas element.
 */

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Render the current canvas state to a PNG Blob at optional high-res scale.
 *
 * @param canvas  Source canvas whose contents will be exported
 * @param width   Output width in CSS pixels (defaults to canvas.width)
 * @param height  Output height in CSS pixels (defaults to canvas.height)
 * @param scale   Resolution multiplier (1 = normal, 2 = retina, 3 = ultra)
 * @returns       Promise resolving to a PNG Blob
 */
export function exportAsPNG(
  canvas: HTMLCanvasElement,
  width?: number,
  height?: number,
  scale: number = 1,
): Promise<Blob> {
  const w = width ?? canvas.width;
  const h = height ?? canvas.height;
  const scaledW = Math.round(w * scale);
  const scaledH = Math.round(h * scale);

  return new Promise<Blob>((resolve, reject) => {
    const { target, ctx } = createExportCanvas(scaledW, scaledH);
    if (!ctx) {
      reject(new Error('Failed to get 2D context for export canvas'));
      return;
    }

    ctx.scale(scale, scale);
    ctx.drawImage(canvas, 0, 0, w, h);

    const handleBlob = (blob: Blob | null): void => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas toBlob returned null'));
      }
    };

    if ('toBlob' in target) {
      (target as HTMLCanvasElement).toBlob(handleBlob, 'image/png');
    } else if ('convertToBlob' in target) {
      (target as OffscreenCanvas)
        .convertToBlob({ type: 'image/png' })
        .then(handleBlob)
        .catch(reject);
    } else {
      reject(new Error('No supported method to convert canvas to blob'));
    }
  });
}

function createExportCanvas(
  w: number,
  h: number,
): { target: HTMLCanvasElement | OffscreenCanvas; ctx: Canvas2D | null } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const target = new OffscreenCanvas(w, h);
    const ctx = target.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    return { target, ctx };
  }
  const target = document.createElement('canvas');
  target.width = w;
  target.height = h;
  return { target, ctx: target.getContext('2d') };
}

/**
 * Trigger a browser download of a PNG Blob.
 *
 * Creates a temporary object URL, clicks an invisible anchor, then
 * revokes the url to free memory.
 *
 * @param blob      The PNG Blob to download
 * @param filename  File name (defaults to `spectre-puzzle-{timestamp}.png`)
 */
export function downloadPNG(blob: Blob, filename?: string): void {
  const name = filename ?? `spectre-puzzle-${Date.now()}.png`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
