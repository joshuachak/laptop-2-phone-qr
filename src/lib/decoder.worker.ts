/// <reference lib="webworker" />
import jsQR from 'jsqr';

export interface DecodeRequest {
  id: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  colour: boolean;
}

export interface DecodeResponse {
  id: number;
  codes: Uint8Array[];
  ms: number;
}

function decode(data: Uint8ClampedArray, w: number, h: number): Uint8Array | null {
  const r = jsQR(data, w, h, { inversionAttempts: 'dontInvert' });
  return r ? new Uint8Array(r.binaryData) : null;
}

/** Copy one colour channel into a grey image so jsQR sees only that layer. */
function channel(src: Uint8ClampedArray, c: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const v = src[i + c];
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const t0 = performance.now();
  const { id, width, height, pixels, colour } = e.data;
  const data = new Uint8ClampedArray(pixels);
  const codes: Uint8Array[] = [];
  if (colour) {
    for (let c = 0; c < 3; c++) {
      const r = decode(channel(data, c), width, height);
      if (r) codes.push(r);
    }
  } else {
    const r = decode(data, width, height);
    if (r) codes.push(r);
  }
  const res: DecodeResponse = { id, codes, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(res);
};
