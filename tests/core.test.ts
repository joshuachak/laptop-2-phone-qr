import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { utf8 } from '../src/lib/bytes';
import { FountainDecoder, FountainEncoder } from '../src/lib/fountain';
import { classify, decodeFountainFrame, encodeCompactText, encodeFountainFrame, packBundle, unpackBundle } from '../src/lib/packet';
import { makeQr, type QrMatrix } from '../src/lib/qr';

function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

/** Render QR layers to RGBA pixels like drawLayers does, 4 px per module. */
function rasterise(layers: QrMatrix[], cell = 4): { data: Uint8ClampedArray; w: number } {
  const size = layers[0].size + 8;
  const w = size * cell;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.floor(y / cell) - 4;
      const c = Math.floor(x / cell) - 4;
      if (r < 0 || c < 0 || r >= layers[0].size || c >= layers[0].size) continue;
      const i = (y * w + x) * 4;
      if (layers.length === 1) {
        if (layers[0].dark(r, c)) data[i] = data[i + 1] = data[i + 2] = 0;
      } else {
        for (let ch = 0; ch < 3; ch++) data[i + ch] = layers[ch].dark(r, c) ? 0 : 255;
      }
    }
  }
  return { data, w };
}

function channel(src: Uint8ClampedArray, c: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) out[i] = out[i + 1] = out[i + 2] = src[i + c], (out[i + 3] = 255);
  return out;
}

describe('fountain code', () => {
  it('rebuilds a file from a lossy, shuffled stream', () => {
    const data = randomBytes(50_000);
    const enc = new FountainEncoder(data, 600, 42);
    const dec = new FountainDecoder(data.length, 600, 42);
    let seed = 0;
    // Drop 40% of packets, including most of the systematic ones.
    while (!dec.done && seed < enc.k * 5) {
      if ((seed * 7919) % 10 >= 4) dec.add(seed, enc.packet(seed));
      seed++;
    }
    expect(dec.done).toBe(true);
    expect(dec.result()).toEqual(data);
  });

  it('needs only a little overhead when joining late', () => {
    const data = randomBytes(30_000, 7);
    const enc = new FountainEncoder(data, 500, 9);
    const dec = new FountainDecoder(data.length, 500, 9);
    let used = 0;
    for (let seed = enc.k; !dec.done; seed++, used++) dec.add(seed, enc.packet(seed));
    expect(dec.result()).toEqual(data);
    expect(used / enc.k).toBeLessThan(1.6);
  });
});

describe('packets', () => {
  it('round-trips compact text and bundles', () => {
    const text = 'Hello 👋 '.repeat(50);
    expect(classify(encodeCompactText(text))).toMatchObject({ kind: 'text', text, compact: true });
    const b = { name: 'a.txt', type: 'text/plain', data: utf8(text) };
    expect(unpackBundle(packBundle(b))).toEqual(b);
    const raw = { name: 'r.bin', type: '', data: randomBytes(3000) };
    expect(unpackBundle(packBundle(raw))).toEqual(raw);
  });
});

describe('QR round trip through pixels', () => {
  it('decodes binary fountain frames', () => {
    const data = randomBytes(585);
    const frame = encodeFountainFrame({ transferId: 5, length: 9999, blockSize: 585, seed: 77, data });
    const { data: px, w } = rasterise([makeQr(frame, 'L')]);
    const r = jsQR(px, w, w)!;
    expect(r).toBeTruthy();
    const back = decodeFountainFrame(new Uint8Array(r.binaryData));
    expect(back.seed).toBe(77);
    expect(back.data).toEqual(data);
  });

  it('decodes three codes packed into colour channels', () => {
    const frames = [0, 1, 2].map((s) => encodeFountainFrame({ transferId: 1, length: 2000, blockSize: 385, seed: s, data: randomBytes(385, s + 3) }));
    const { data: px, w } = rasterise(frames.map((f) => makeQr(f, 'L')));
    for (let c = 0; c < 3; c++) {
      const r = jsQR(channel(px, c), w, w)!;
      expect(new Uint8Array(r.binaryData)).toEqual(frames[c]);
    }
  });
});
