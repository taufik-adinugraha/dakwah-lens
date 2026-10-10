/**
 * Share-link codec (plan D9, §9.4; architecture.md §6.4): answers ⇄ a compact, versioned token
 * for the URL FRAGMENT (`/belajar/id/waris/laporan#j=v1.<base64url>`, never a query string), and
 * the short answer code printed on the report ("W1-7K3Q") so two printouts can be matched.
 *
 *  - Only EFFECTIVE answers are written (the caller passes walk().eff): irrelevant answers drop.
 *  - The killer answer (A3 k6) has no code: the A3 catalog does not contain it, so it cannot be
 *    written even by mistake (plan §5.6).
 *  - Rupiah amounts are written only when the caller ticks "Sertakan nilai rupiah" (plan §5.7).
 *  - decode() never throws: malformed, oversized, unknown-version or out-of-range tokens → null.
 *
 * Layout (bytes, then base64url): entries [varint code][varint instance if loop][value], a 0,
 * then optional amounts [varint field][varint bigint]… and a 0. Value: varint 0 = «Tidak tahu»;
 * pilih/peran: index+1; pilih_banyak: bitmask+1; jumlah: n+1; jumlah_lp: L+1 then P.
 * Codes are append-only (graph.ts). Integer bit operations only (waris lint: no `/`, `%`, Math).
 */
import { HEIRS } from "../registry";
import { MAX_ANAK_WAFAT, NODE, NODES, type NodeDef } from "./graph";
import { TIDAK_TAHU, type Amounts, type AnswerValue, type Answers, type LP } from "./types";

export const CODEC_VERSION = "v1";
/** Longest token accepted (a full family with amounts is ~120 characters). */
export const MAX_TOKEN_LENGTH = 1024;

const BY_CODE = new Map<number, NodeDef>(NODES.map((d) => [d.code, d]));
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const AMOUNT_FIELDS = ["hartaBersama", "hartaBawaan", "biayaSakit", "biayaJenazah", "utang", "wasiatLain", "wasiatWaris"] as const;
const FLAG_SEMUA_MILIK = 8;

// ---------------------------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------------------------

function putVar(out: number[], x: number) {
  let v = x >>> 0;
  while (v >= 128) {
    out.push((v & 127) | 128);
    v = v >>> 7;
  }
  out.push(v);
}

const B127 = BigInt(127);
const B128 = BigInt(128);
const B7 = BigInt(7);
function putBig(out: number[], x: bigint) {
  let v = x < BigInt(0) ? BigInt(0) : x;
  while (v >= B128) {
    out.push(parseInt((v & B127).toString(), 10) | 128);
    v = v >> B7;
  }
  out.push(parseInt(v.toString(), 10));
}

class Reader {
  private at = 0;
  constructor(private readonly b: readonly number[]) {}
  done(): boolean {
    return this.at >= this.b.length;
  }
  /** null on overrun or an over-long varint. */
  varint(): number | null {
    let v = 0;
    let shift = 0;
    for (let k = 0; k < 5; k++) {
      if (this.at >= this.b.length) return null;
      const c = this.b[this.at++];
      v = v | ((c & 127) << shift);
      if ((c & 128) === 0) return v >>> 0;
      shift += 7;
    }
    return null;
  }
  big(): bigint | null {
    let v = BigInt(0);
    let shift = BigInt(0);
    for (let k = 0; k < 10; k++) {
      if (this.at >= this.b.length) return null;
      const c = this.b[this.at++];
      v = v | (BigInt(c & 127) << shift);
      if ((c & 128) === 0) return v;
      shift = shift + B7;
    }
    return null;
  }
}

function toB64(bytes: readonly number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64.charAt((n >>> 18) & 63) + B64.charAt((n >>> 12) & 63);
    if (i + 1 < bytes.length) s += B64.charAt((n >>> 6) & 63);
    if (i + 2 < bytes.length) s += B64.charAt(n & 63);
  }
  return s;
}

function fromB64(s: string): number[] | null {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s.charAt(i));
    if (v < 0) return null;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >>> bits) & 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

function catalogOf(d: NodeDef): readonly string[] {
  return d.kind === "peran" ? HEIRS : d.options;
}

function putValue(out: number[], d: NodeDef, v: AnswerValue): boolean {
  if (v === TIDAK_TAHU) {
    putVar(out, 0);
    return true;
  }
  const cat = catalogOf(d);
  switch (d.kind) {
    case "pilih":
    case "peran": {
      const idx = typeof v === "string" ? cat.indexOf(v) : -1;
      if (idx < 0) return false;
      putVar(out, idx + 1);
      return true;
    }
    case "pilih_banyak": {
      if (!Array.isArray(v)) return false;
      let mask = 0;
      for (const x of v as readonly string[]) {
        const idx = cat.indexOf(x);
        if (idx < 0) return false;
        mask = mask | (1 << idx);
      }
      putVar(out, mask + 1);
      return true;
    }
    case "jumlah":
      if (typeof v !== "number") return false;
      putVar(out, v + 1);
      return true;
    case "jumlah_lp": {
      const x = v as LP;
      if (typeof x !== "object" || x === null || typeof x.L !== "number" || typeof x.P !== "number") return false;
      putVar(out, x.L + 1);
      putVar(out, x.P);
      return true;
    }
  }
}

function answerBytes(eff: Answers): number[] {
  const out: number[] = [];
  for (const [key, v] of Object.entries(eff)) {
    const dot = key.indexOf(".");
    const id = dot < 0 ? key : key.slice(0, dot);
    const d = NODE[id as keyof typeof NODE];
    if (!d) continue;
    const entry: number[] = [];
    putVar(entry, d.code);
    if (d.loop) putVar(entry, parseInt(key.slice(dot + 1), 10));
    if (!putValue(entry, d, v)) continue;
    out.push(...entry);
  }
  putVar(out, 0);
  return out;
}

export interface EncodeOptions {
  /** "Sertakan nilai rupiah" (plan D9): amounts enter the link only when ticked. */
  sertakanRupiah: boolean;
}

/** The fragment token for effective answers (machine.walk(answers).eff). */
export function encodeEff(eff: Answers, amounts?: Amounts, opts: EncodeOptions = { sertakanRupiah: false }): string {
  const bytes = answerBytes(eff);
  if (opts.sertakanRupiah && amounts) {
    AMOUNT_FIELDS.forEach((f, idx) => {
      const x = amounts[f];
      if (x !== undefined) {
        putVar(bytes, idx + 1);
        putBig(bytes, x);
      }
    });
    if (amounts.semuaMilikAlmarhum) {
      putVar(bytes, FLAG_SEMUA_MILIK);
      putBig(bytes, BigInt(1));
    }
    putVar(bytes, 0);
  }
  return `${CODEC_VERSION}.${toB64(bytes)}`;
}

export interface Decoded {
  answers: Answers;
  amounts?: Amounts;
}

/** Token → answers (+ amounts when the link carried them). null for anything malformed. */
export function decode(token: string): Decoded | null {
  try {
    return decodeInner(token);
  } catch {
    return null;
  }
}

function decodeInner(token: unknown): Decoded | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const version = token.slice(0, dot);
  // migration hook: a future v2 decodes v1 tokens here and maps their codes forward
  if (version !== CODEC_VERSION) return null;
  const bytes = fromB64(token.slice(dot + 1));
  if (!bytes) return null;
  const r = new Reader(bytes);
  const answers: Record<string, AnswerValue> = {};
  for (;;) {
    const code = r.varint();
    if (code === null) return null;
    if (code === 0) break;
    const d = BY_CODE.get(code);
    if (!d) return null;
    let key: string = d.id;
    if (d.loop) {
      const i = r.varint();
      if (i === null || i < 1 || i > MAX_ANAK_WAFAT) return null;
      key = `${d.id}.${i}`;
    }
    if (key in answers) return null;
    const v = readValue(r, d);
    if (v === null) return null;
    answers[key] = v;
  }
  let amounts: Amounts | undefined;
  if (!r.done()) {
    const am: { -readonly [K in keyof Amounts]: Amounts[K] } = {};
    for (;;) {
      const f = r.varint();
      if (f === null) return null;
      if (f === 0) break;
      const x = r.big();
      if (x === null) return null;
      if (f === FLAG_SEMUA_MILIK) am.semuaMilikAlmarhum = x === BigInt(1);
      else if (f >= 1 && f <= AMOUNT_FIELDS.length) am[AMOUNT_FIELDS[f - 1]] = x;
      else return null;
    }
    if (!r.done()) return null;
    amounts = am;
  }
  return amounts ? { answers, amounts } : { answers };
}

function readValue(r: Reader, d: NodeDef): AnswerValue | null {
  const cat = catalogOf(d);
  const first = r.varint();
  if (first === null) return null;
  if (first === 0) {
    // «Tidak tahu» (G4's "belum" is an ordinary option)
    return d.unknown ? TIDAK_TAHU : null;
  }
  switch (d.kind) {
    case "pilih":
    case "peran":
      return first - 1 < cat.length ? cat[first - 1] : null;
    case "pilih_banyak": {
      const mask = first - 1;
      if (mask >>> cat.length !== 0) return null;
      return cat.filter((_, idx) => (mask & (1 << idx)) !== 0);
    }
    case "jumlah":
      return first - 1 <= d.max ? first - 1 : null;
    case "jumlah_lp": {
      const P = r.varint();
      if (P === null || first - 1 > d.max || P > d.max) return null;
      return { L: first - 1, P };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fragment and answer code
// ---------------------------------------------------------------------------------------------

/** "#j=<token>" body (without the "#"). */
export function fragmentFor(token: string): string {
  return `j=${token}`;
}

/** The token inside a location.hash ("#j=v1.…"), or null. */
export function tokenFromHash(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of h.split("&")) if (part.startsWith("j=")) return part.slice(2);
  return null;
}

/** FNV-1a 32-bit over bytes; the ×16777619 is done as shifts so it stays exact (no Math.imul). */
function fnv1a(bytes: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h = (h ^ b) >>> 0;
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

/**
 * "W1-" + four Crockford base-32 characters of a 20-bit hash of the ANSWERS (amounts never enter
 * it, plan D9). The same answers always give the same code; it identifies, it does not encrypt.
 */
export function answerCodeOf(eff: Answers): string {
  const h = fnv1a(answerBytes(eff));
  let out = "";
  for (const shift of [15, 10, 5, 0]) out += CROCKFORD.charAt((h >>> shift) & 31);
  return `W1-${out}`;
}
