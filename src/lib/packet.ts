import { deflateSync, inflateSync } from 'fflate';
import { concat, fromUtf8, utf8 } from './bytes';

/**
 * What a scanned QR code can carry. The first byte says which kind it is.
 *   0x01  compact text: deflate-compressed UTF-8 (needs our scanner)
 *   0x02  one fountain-coded frame of a file or long text (animated QR)
 *   0x03  a WebRTC connection reply (P2P experiment)
 * Anything else is treated as plain text, so ordinary QR codes scan too.
 */
export const KIND_TEXT = 0x01;
export const KIND_FOUNTAIN = 0x02;
export const KIND_SIGNAL = 0x03;

export const FOUNTAIN_HEADER = 15;

export interface FountainFrame {
  transferId: number;
  length: number;
  blockSize: number;
  seed: number;
  data: Uint8Array;
}

export function encodeCompactText(text: string): Uint8Array {
  return concat(new Uint8Array([KIND_TEXT]), deflateSync(utf8(text), { level: 9 }));
}

export function encodeFountainFrame(f: FountainFrame): Uint8Array {
  const out = new Uint8Array(FOUNTAIN_HEADER + f.data.length);
  const v = new DataView(out.buffer);
  out[0] = KIND_FOUNTAIN;
  v.setUint32(1, f.transferId);
  v.setUint32(5, f.length);
  v.setUint16(9, f.blockSize);
  v.setUint32(11, f.seed);
  out.set(f.data, FOUNTAIN_HEADER);
  return out;
}

export function decodeFountainFrame(b: Uint8Array): FountainFrame {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    transferId: v.getUint32(1),
    length: v.getUint32(5),
    blockSize: v.getUint16(9),
    seed: v.getUint32(11),
    data: b.subarray(FOUNTAIN_HEADER),
  };
}

/** A file or text bundled with its name and type, ready to be fountain coded. */
export interface Bundle {
  name: string;
  type: string;
  data: Uint8Array;
}

/** [u16 meta length][meta JSON][body]. The body is deflated when that saves 5% or more. */
export function packBundle(b: Bundle): Uint8Array {
  const z = deflateSync(b.data, { level: 6 });
  const useZ = z.length < b.data.length * 0.95;
  const meta = utf8(JSON.stringify({ n: b.name, t: b.type, z: useZ ? 1 : 0 }));
  const head = new Uint8Array(2);
  new DataView(head.buffer).setUint16(0, meta.length);
  return concat(head, meta, useZ ? z : b.data);
}

export function unpackBundle(bytes: Uint8Array): Bundle {
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint16(0);
  const meta = JSON.parse(fromUtf8(bytes.subarray(2, 2 + len))) as { n: string; t: string; z: number };
  const body = bytes.subarray(2 + len);
  return { name: meta.n, type: meta.t, data: meta.z ? inflateSync(body) : body };
}

export type Scanned =
  | { kind: 'text'; text: string; compact: boolean }
  | { kind: 'fountain'; frame: FountainFrame }
  | { kind: 'signal'; payload: Uint8Array };

export function classify(b: Uint8Array): Scanned {
  switch (b[0]) {
    case KIND_TEXT:
      return { kind: 'text', text: fromUtf8(inflateSync(b.subarray(1))), compact: true };
    case KIND_FOUNTAIN:
      return { kind: 'fountain', frame: decodeFountainFrame(b) };
    case KIND_SIGNAL:
      return { kind: 'signal', payload: b.subarray(1) };
    default:
      return { kind: 'text', text: fromUtf8(b), compact: false };
  }
}
