/**
 * A small LT (Luby transform) fountain code.
 *
 * The sender turns K source blocks into an endless stream of packets. Packet seeds
 * 0..K-1 are the source blocks themselves ("systematic"), so a perfect capture
 * finishes after exactly K frames. Later seeds XOR a random set of blocks together,
 * chosen with the robust soliton distribution, so any ~K * 1.1 distinct packets
 * usually rebuild the whole file, whatever order they arrive in.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cdfCache = new Map<number, Float64Array>();

/** Cumulative robust soliton distribution over degrees 1..K. */
function solitonCdf(k: number): Float64Array {
  const cached = cdfCache.get(k);
  if (cached) return cached;
  const c = 0.1;
  const delta = 0.5;
  const R = c * Math.log(k / delta) * Math.sqrt(k);
  const pivot = Math.max(1, Math.min(k, Math.floor(k / R)));
  const p = new Float64Array(k + 1);
  for (let d = 1; d <= k; d++) {
    const rho = d === 1 ? 1 / k : 1 / (d * (d - 1));
    let tau = 0;
    if (d < pivot) tau = R / (d * k);
    else if (d === pivot) tau = (R * Math.log(R / delta)) / k;
    p[d] = rho + Math.max(0, tau);
  }
  const cdf = new Float64Array(k + 1);
  let sum = 0;
  for (let d = 1; d <= k; d++) sum += p[d];
  let acc = 0;
  for (let d = 1; d <= k; d++) {
    acc += p[d] / sum;
    cdf[d] = acc;
  }
  cdfCache.set(k, cdf);
  return cdf;
}

/** Which source blocks a packet with this seed combines. Sender and receiver must agree. */
export function blockIndices(k: number, seed: number, transferId: number): number[] {
  if (seed < k) return [seed];
  const rand = mulberry32((Math.imul(seed, 2654435761) ^ transferId) >>> 0);
  const cdf = solitonCdf(k);
  const u = rand();
  let degree = 1;
  while (degree < k && cdf[degree] < u) degree++;
  const picked = new Set<number>();
  while (picked.size < degree) picked.add(Math.floor(rand() * k));
  return [...picked];
}

function xorInto(target: Uint8Array, src: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] ^= src[i];
}

export class FountainEncoder {
  readonly k: number;
  private blocks: Uint8Array[];

  constructor(data: Uint8Array, readonly blockSize: number, readonly transferId: number) {
    this.k = Math.max(1, Math.ceil(data.length / blockSize));
    this.blocks = [];
    for (let i = 0; i < this.k; i++) {
      const b = new Uint8Array(blockSize);
      b.set(data.subarray(i * blockSize, (i + 1) * blockSize));
      this.blocks.push(b);
    }
  }

  packet(seed: number): Uint8Array {
    const out = new Uint8Array(this.blockSize);
    for (const i of blockIndices(this.k, seed, this.transferId)) xorInto(out, this.blocks[i]);
    return out;
  }
}

export class FountainDecoder {
  readonly k: number;
  private known: (Uint8Array | null)[];
  private knownCount = 0;
  private seen = new Set<number>();
  /** Packets that still combine 2+ unknown blocks. */
  private pending = new Map<number, { rest: Set<number>; data: Uint8Array }>();
  private waiting: Set<number>[] = [];
  private nextId = 0;

  constructor(readonly length: number, readonly blockSize: number, readonly transferId: number) {
    this.k = Math.max(1, Math.ceil(length / blockSize));
    this.known = new Array(this.k).fill(null);
    for (let i = 0; i < this.k; i++) this.waiting.push(new Set());
  }

  get progress(): number {
    return this.knownCount / this.k;
  }
  get done(): boolean {
    return this.knownCount === this.k;
  }
  get received(): number {
    return this.seen.size;
  }

  /** Feed one packet. Returns false if it was a duplicate. */
  add(seed: number, payload: Uint8Array): boolean {
    if (this.seen.has(seed) || this.done) return false;
    this.seen.add(seed);
    const data = payload.slice(0, this.blockSize);
    const rest = new Set<number>();
    for (const i of blockIndices(this.k, seed, this.transferId)) {
      const kb = this.known[i];
      if (kb) xorInto(data, kb);
      else rest.add(i);
    }
    if (rest.size === 0) return true;
    if (rest.size === 1) {
      this.solve([...rest][0], data);
      return true;
    }
    const id = this.nextId++;
    this.pending.set(id, { rest, data });
    for (const i of rest) this.waiting[i].add(id);
    return true;
  }

  private solve(first: number, firstData: Uint8Array): void {
    const queue: [number, Uint8Array][] = [[first, firstData]];
    while (queue.length) {
      const [idx, data] = queue.pop()!;
      if (this.known[idx]) continue;
      this.known[idx] = data;
      this.knownCount++;
      for (const pid of this.waiting[idx]) {
        const p = this.pending.get(pid);
        if (!p) continue;
        xorInto(p.data, data);
        p.rest.delete(idx);
        if (p.rest.size === 1) {
          const last = [...p.rest][0];
          this.pending.delete(pid);
          this.waiting[last].delete(pid);
          queue.push([last, p.data]);
        }
      }
      this.waiting[idx].clear();
    }
  }

  result(): Uint8Array {
    if (!this.done) throw new Error('not finished');
    const out = new Uint8Array(this.length);
    for (let i = 0; i < this.k; i++) {
      out.set(this.known[i]!.subarray(0, Math.min(this.blockSize, this.length - i * this.blockSize)), i * this.blockSize);
    }
    return out;
  }
}
