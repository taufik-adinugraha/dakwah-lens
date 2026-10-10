/**
 * Indonesian number and fraction words for the report (plan §6 row 1: "fraction in figures and
 * words"). Formatting only, no copy: "seperdelapan", "dua pertiga", "tujuh perdua belas".
 *
 * Integer-only and division-free (the waris lint block bans `/`, `%`, Math and Number outside
 * frac.ts): a number is spelled from its decimal digit string in groups of three. Every word form
 * parses back to the same fraction (parseFractionWords), which the report checks assert for every
 * fraction the report shows.
 */
import { frac, type Frac } from "../frac";

const DIGITS = "0123456789";
const UNIT = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"] as const;
/** Scale words for groups of three digits; index 1 = ribu (10^3), 2 = juta (10^6), … */
const SCALE = ["", "ribu", "juta", "miliar", "triliun", "kuadriliun"] as const;

function digit(s: string, i: number): number {
  return DIGITS.indexOf(s.charAt(i));
}

/** Words for a three-digit group "001".."999" (never "000"). */
function groupWords(g: string): string[] {
  const h = digit(g, 0);
  const t = digit(g, 1);
  const u = digit(g, 2);
  const out: string[] = [];
  if (h === 1) out.push("seratus");
  else if (h > 1) out.push(UNIT[h], "ratus");
  if (t === 0) {
    if (u > 0) out.push(UNIT[u]);
  } else if (t === 1) {
    if (u === 0) out.push("sepuluh");
    else if (u === 1) out.push("sebelas");
    else out.push(UNIT[u], "belas");
  } else {
    out.push(UNIT[t], "puluh");
    if (u > 0) out.push(UNIT[u]);
  }
  return out;
}

/**
 * "nol", "satu", "sebelas", "dua puluh empat", "seratus", "seribu dua ratus", "satu juta".
 * Numbers beyond the kuadriliun scale are written in figures (still parsed back).
 */
export function numberWords(x: bigint): string {
  if (x < BigInt(0)) throw new Error("waris/report/words: negative number");
  let s = x.toString();
  if (s === "0") return UNIT[0];
  // pad to whole groups of three digits (no `%`: the waris lint block bans it outside frac.ts)
  let r = s.length;
  while (r > 3) r -= 3;
  while (r < 3) {
    s = "0" + s;
    r += 1;
  }
  const groups: string[] = [];
  for (let i = 0; i < s.length; i += 3) groups.push(s.slice(i, i + 3));
  if (groups.length > SCALE.length) return x.toString();
  const out: string[] = [];
  groups.forEach((g, gi) => {
    if (g === "000") return;
    const scale = groups.length - 1 - gi;
    if (scale === 1 && g === "001") {
      out.push("seribu");
      return;
    }
    out.push(...groupWords(g));
    if (scale > 0) out.push(SCALE[scale]);
  });
  return out.join(" ");
}

/** The "per…" form of a denominator: "pertiga", "perdua belas", "persejuta". */
function perForm(d: bigint): string {
  let w = numberWords(d);
  // "satu juta" → "sejuta" (and miliar, triliun, …): "sepersejuta", "tiga persejuta"
  if (w.startsWith("satu ")) w = "se" + w.slice("satu ".length);
  return "per" + w;
}

/** Words for a share: "seluruhnya", "setengah", "sepertiga", "dua pertiga", "tujuh perdua belas". */
export function fractionWords(f: Frac): string {
  const one = BigInt(1);
  if (f.n === BigInt(0)) return UNIT[0];
  if (f.d === one) return f.n === one ? "seluruhnya" : numberWords(f.n);
  if (f.n === one && f.d === BigInt(2)) return "setengah";
  if (f.n === one) return "se" + perForm(f.d);
  return `${numberWords(f.n)} ${perForm(f.d)}`;
}

// ---------------------------------------------------------------------------------------------
// Parsing (round trip): used by the report checks, and available to the UI for screen-reader text.
// ---------------------------------------------------------------------------------------------

const SCALE_VALUE: Record<string, bigint> = {
  ribu: BigInt(1000),
  juta: BigInt(1000000),
  miliar: BigInt(1000000000),
  triliun: BigInt("1000000000000"),
  kuadriliun: BigInt("1000000000000000"),
};

/** Inverse of numberWords. Throws on any word it does not know. */
export function parseNumberWords(s: string): bigint {
  const text = s.trim();
  if (/^[0-9]+$/.test(text)) return BigInt(text);
  let total = BigInt(0);
  let cur = BigInt(0);
  let pending = BigInt(0);
  for (const tok of text.split(/\s+/)) {
    const u = (UNIT as readonly string[]).indexOf(tok);
    if (u >= 0) {
      pending = BigInt(u);
      continue;
    }
    switch (tok) {
      case "sepuluh":
        cur += BigInt(10);
        break;
      case "sebelas":
        cur += BigInt(11);
        break;
      case "seratus":
        cur += BigInt(100);
        break;
      case "belas":
        cur += pending + BigInt(10);
        pending = BigInt(0);
        break;
      case "puluh":
        cur += pending * BigInt(10);
        pending = BigInt(0);
        break;
      case "ratus":
        cur += pending * BigInt(100);
        pending = BigInt(0);
        break;
      case "seribu":
        total += BigInt(1000);
        break;
      default: {
        if (tok.startsWith("se") && SCALE_VALUE[tok.slice(2)] !== undefined) {
          total += SCALE_VALUE[tok.slice(2)];
          break;
        }
        const scale = SCALE_VALUE[tok];
        if (scale === undefined) throw new Error(`waris/report/words: unknown number word "${tok}" in "${s}"`);
        total += (cur + pending) * scale;
        cur = BigInt(0);
        pending = BigInt(0);
      }
    }
  }
  return total + cur + pending;
}

/** Inverse of fractionWords (no normalisation: the words of n/d give back n and d). */
export function parseFractionWords(s: string): Frac {
  const text = s.trim();
  if (text === "seluruhnya") return frac(1, 1);
  if (text === "setengah") return frac(1, 2);
  if (text === UNIT[0]) return frac(0, 1);
  if (text.startsWith("seper")) return { n: BigInt(1), d: parseNumberWords(text.slice("seper".length)) };
  const toks = text.split(/\s+/);
  const at = toks.findIndex((t) => t.startsWith("per"));
  if (at < 0) return { n: parseNumberWords(text), d: BigInt(1) };
  if (at === 0) throw new Error(`waris/report/words: no numerator in "${s}"`);
  const n = parseNumberWords(toks.slice(0, at).join(" "));
  const d = parseNumberWords([toks[at].slice("per".length), ...toks.slice(at + 1)].join(" "));
  return { n, d };
}
