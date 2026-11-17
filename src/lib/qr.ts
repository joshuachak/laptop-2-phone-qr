import qrcode from 'qrcode-generator';
import { toLatin1 } from './bytes';

export type Ecc = 'L' | 'M' | 'Q' | 'H';

/** A QR module matrix: true = dark. */
export interface QrMatrix {
  size: number;
  dark: (r: number, c: number) => boolean;
}

/** Encode raw bytes in QR byte mode, picking the smallest version that fits. */
export function makeQr(bytes: Uint8Array, ecc: Ecc = 'L'): QrMatrix {
  const qr = qrcode(0, ecc);
  qr.addData(toLatin1(bytes), 'Byte');
  qr.make();
  return { size: qr.getModuleCount(), dark: (r, c) => qr.isDark(r, c) };
}

const QUIET = 4;

/** Draw one black-and-white QR code, scaled to fill the canvas's CSS box. */
export function drawQr(canvas: HTMLCanvasElement, m: QrMatrix): void {
  drawLayers(canvas, [m]);
}

/**
 * Draw 1 or 3 QR codes. With 3, each code goes in its own colour channel (R, G, B):
 * a module is "off" (0) in a channel where that code is dark, so the colours mix.
 * All layers must be the same size.
 */
export function drawLayers(canvas: HTMLCanvasElement, layers: QrMatrix[]): void {
  const size = layers[0].size;
  const total = size + QUIET * 2;
  const css = Math.min(canvas.clientWidth || 512, canvas.clientHeight || canvas.clientWidth || 512);
  const dpr = window.devicePixelRatio || 1;
  const cell = Math.max(1, Math.floor((css * dpr) / total));
  const px = cell * total;
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  // Paint one pixel per module, then scale it up without smoothing: much faster than fillRect per module.
  const img = new ImageData(total, total);
  img.data.fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = ((r + QUIET) * total + c + QUIET) * 4;
      if (layers.length === 1) {
        if (layers[0].dark(r, c)) img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      } else {
        for (let ch = 0; ch < 3; ch++) if (layers[ch].dark(r, c)) img.data[i + ch] = 0;
      }
    }
  }
  if (!small || small.width !== total) {
    small = document.createElement('canvas');
    small.width = total;
    small.height = total;
  }
  small.getContext('2d')!.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, px, px);
}

let small: HTMLCanvasElement | null = null;
