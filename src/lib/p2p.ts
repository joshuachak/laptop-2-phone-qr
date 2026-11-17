import { deflateSync, inflateSync } from 'fflate';
import { concat, fromUtf8, utf8 } from './bytes';
import { KIND_SIGNAL } from './packet';

/**
 * Serverless WebRTC: instead of a signalling server, the offer and answer travel
 * by QR code (or copy-paste). We wait for ICE gathering to finish so each side's
 * description already lists every address it can be reached on.
 */

const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const CHUNK = 64 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;

export interface Offer {
  sdp: string;
  stun: boolean;
}

export function encodeOffer(o: Offer): Uint8Array {
  return deflateSync(utf8(JSON.stringify({ s: o.sdp, u: o.stun ? 1 : 0 })), { level: 9 });
}
export function decodeOffer(b: Uint8Array): Offer {
  const j = JSON.parse(fromUtf8(inflateSync(b))) as { s: string; u: number };
  return { sdp: j.s, stun: !!j.u };
}
/** The reply carries a leading KIND_SIGNAL byte so the scanner can tell it apart. */
export function encodeAnswer(sdp: string): Uint8Array {
  return concat(new Uint8Array([KIND_SIGNAL]), deflateSync(utf8(sdp), { level: 9 }));
}
export function decodeAnswer(b: Uint8Array): string {
  if (b[0] !== KIND_SIGNAL) throw new Error('not a reply code');
  return fromUtf8(inflateSync(b.subarray(1)));
}

function gathered(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => pc.iceGatheringState === 'complete' && resolve();
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, timeoutMs);
  });
}

export type Incoming =
  | { kind: 'text'; text: string }
  | { kind: 'file'; name: string; type: string; data: Uint8Array; ms: number };

export interface PeerEvents {
  onOpen: () => void;
  onClose: () => void;
  onReceive: (m: Incoming) => void;
  onProgress: (p: { dir: 'in' | 'out'; name: string; done: number; total: number; ms: number }) => void;
}

export class Peer {
  readonly pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private incoming: { name: string; type: string; size: number; parts: Uint8Array[]; got: number; t0: number } | null = null;

  constructor(stun: boolean, private ev: PeerEvents) {
    this.pc = new RTCPeerConnection({ iceServers: stun ? STUN : [] });
    this.pc.ondatachannel = (e) => this.bind(e.channel);
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) ev.onClose();
    };
  }

  /** Mac side: make the offer to show as a QR code. */
  async createOffer(): Promise<string> {
    this.bind(this.pc.createDataChannel('data', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await gathered(this.pc);
    return this.pc.localDescription!.sdp;
  }

  /** Phone side: take the offer and produce the reply. */
  async acceptOffer(sdp: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await gathered(this.pc);
    return this.pc.localDescription!.sdp;
  }

  /** Mac side: finish with the phone's reply. */
  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  /** How the two devices ended up connected: same network, across the internet, or via a relay. */
  async route(): Promise<string> {
    const stats = await this.pc.getStats();
    let pairId = '';
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
    stats.forEach((s) => {
      if ((pairId && s.id === pairId) || (!pairId && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')) pair = s;
    });
    if (!pair) return 'unknown';
    const local = stats.get(pair.localCandidateId!);
    const remote = stats.get(pair.remoteCandidateId!);
    const types = [local?.candidateType, remote?.candidateType];
    if (types.includes('relay')) return 'through a relay server';
    if (types.every((t) => t === 'host')) return 'directly over your local network';
    return 'directly across the internet (via your routers)';
  }

  private bind(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1024 * 1024;
    dc.onopen = () => this.ev.onOpen();
    dc.onclose = () => this.ev.onClose();
    dc.onmessage = (e) => this.receive(e.data);
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      const m = JSON.parse(data);
      if (m.t === 'text') this.ev.onReceive({ kind: 'text', text: m.text });
      else if (m.t === 'file') this.incoming = { name: m.name, type: m.type, size: m.size, parts: [], got: 0, t0: performance.now() };
      else if (m.t === 'end' && this.incoming) {
        const f = this.incoming;
        this.incoming = null;
        this.ev.onReceive({ kind: 'file', name: f.name, type: f.type, data: concat(...f.parts), ms: performance.now() - f.t0 });
      }
      return;
    }
    const f = this.incoming;
    if (!f) return;
    const part = new Uint8Array(data);
    f.parts.push(part);
    f.got += part.length;
    this.ev.onProgress({ dir: 'in', name: f.name, done: f.got, total: f.size, ms: performance.now() - f.t0 });
  }

  sendText(text: string): void {
    this.dc?.send(JSON.stringify({ t: 'text', text }));
  }

  async sendFile(file: File): Promise<void> {
    const dc = this.dc;
    if (!dc) throw new Error('not connected');
    const t0 = performance.now();
    dc.send(JSON.stringify({ t: 'file', name: file.name, type: file.type, size: file.size }));
    let sent = 0;
    for (let off = 0; off < file.size; off += 1024 * 1024) {
      const buf = new Uint8Array(await file.slice(off, off + 1024 * 1024).arrayBuffer());
      for (let i = 0; i < buf.length; i += CHUNK) {
        if (dc.bufferedAmount > HIGH_WATER) {
          await new Promise<void>((r) => dc.addEventListener('bufferedamountlow', () => r(), { once: true }));
        }
        const chunk = buf.subarray(i, i + CHUNK);
        dc.send(chunk);
        sent += chunk.length;
        this.ev.onProgress({ dir: 'out', name: file.name, done: sent, total: file.size, ms: performance.now() - t0 });
      }
    }
    dc.send(JSON.stringify({ t: 'end' }));
  }
}
