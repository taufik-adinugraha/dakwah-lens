/**
 * Exact rationals over bigint (engine.md §1 "Arithmetic").
 *
 * Every share in the waris engine is a `Frac`: normalised (gcd(n, d) = 1, d > 0). There is no float
 * path anywhere in the engine; this module is the only place where the `/` and `%` operators are
 * allowed (on bigint only), which the ESLint block for `src/lib/waris/**` enforces.
 *
 * No bigint literals (`1n`): the project tsconfig targets ES2017, where TS rejects them (TS2737).
 */

export type Frac = { readonly n: bigint; readonly d: bigint };

export const B0 = BigInt(0);
export const B1 = BigInt(1);
export const B2 = BigInt(2);
export const B3 = BigInt(3);
export const B100 = BigInt(100);

export function big(x: number | bigint): bigint {
  return typeof x === "bigint" ? x : BigInt(x);
}

export function absB(a: bigint): bigint {
  return a < B0 ? -a : a;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = absB(a);
  let y = absB(b);
  while (y !== B0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function lcm(a: bigint, b: bigint): bigint {
  if (a === B0 || b === B0) return B0;
  return absB((a / gcd(a, b)) * b);
}

export function lcmAll(xs: readonly bigint[]): bigint {
  let acc = B1;
  for (const x of xs) acc = lcm(acc, x);
  return acc;
}

/** Floor division on bigint (rounds towards −∞). */
export function floorDiv(a: bigint, b: bigint): bigint {
  if (b === B0) throw new Error("waris/frac: division by zero");
  const q = a / b;
  const r = a % b;
  return r !== B0 && (r < B0) !== (b < B0) ? q - B1 : q;
}

/** Non-negative remainder matching floorDiv. */
export function floorMod(a: bigint, b: bigint): bigint {
  return a - floorDiv(a, b) * b;
}

export function frac(n: number | bigint, d: number | bigint = B1): Frac {
  let nn = big(n);
  let dd = big(d);
  if (dd === B0) throw new Error("waris/frac: zero denominator");
  if (dd < B0) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  return g > B1 ? { n: nn / g, d: dd / g } : { n: nn, d: dd };
}

export const ZERO: Frac = { n: B0, d: B1 };
export const ONE: Frac = { n: B1, d: B1 };
export const HALF: Frac = frac(1, 2);
export const THIRD: Frac = frac(1, 3);
export const QUARTER: Frac = frac(1, 4);
export const SIXTH: Frac = frac(1, 6);
export const EIGHTH: Frac = frac(1, 8);
export const TWO_THIRDS: Frac = frac(2, 3);

export function add(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Frac, b: Frac): Frac {
  return frac(a.n * b.n, a.d * b.d);
}

export function div(a: Frac, b: Frac): Frac {
  if (b.n === B0) throw new Error("waris/frac: division by zero fraction");
  return frac(a.n * b.d, a.d * b.n);
}

export function mulInt(a: Frac, k: number | bigint): Frac {
  return frac(a.n * big(k), a.d);
}

export function divInt(a: Frac, k: number | bigint): Frac {
  return frac(a.n, a.d * big(k));
}

export function cmp(a: Frac, b: Frac): -1 | 0 | 1 {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export const eq = (a: Frac, b: Frac): boolean => a.n === b.n && a.d === b.d;
export const lt = (a: Frac, b: Frac): boolean => cmp(a, b) < 0;
export const le = (a: Frac, b: Frac): boolean => cmp(a, b) <= 0;
export const gt = (a: Frac, b: Frac): boolean => cmp(a, b) > 0;
export const ge = (a: Frac, b: Frac): boolean => cmp(a, b) >= 0;
export const isZero = (a: Frac): boolean => a.n === B0;
export const isPositive = (a: Frac): boolean => a.n > B0;

export function max(...xs: Frac[]): Frac {
  let m = xs[0];
  for (const x of xs) if (gt(x, m)) m = x;
  return m;
}

export function min(...xs: Frac[]): Frac {
  let m = xs[0];
  for (const x of xs) if (lt(x, m)) m = x;
  return m;
}

export function sum(xs: readonly Frac[]): Frac {
  let acc = ZERO;
  for (const x of xs) acc = add(acc, x);
  return acc;
}

/** "a/b", or "a" when b = 1 (the vector convention writes the whole as "1"). */
export function toStr(a: Frac): string {
  return a.d === B1 ? a.n.toString() : `${a.n.toString()}/${a.d.toString()}`;
}

/** Parse "a/b" or "a" (integers only; no decimals). */
export function parse(s: string): Frac {
  const m = /^\s*(-?\d+)\s*(?:\/\s*(\d+)\s*)?$/.exec(s);
  if (!m) throw new Error(`waris/frac: cannot parse fraction "${s}"`);
  return frac(BigInt(m[1]), m[2] === undefined ? B1 : BigInt(m[2]));
}

/** floor(T × a) and the exact remainder numerator (T × a.n mod a.d), for largest-remainder rounding. */
export function floorTimes(T: bigint, a: Frac): { q: bigint; r: bigint } {
  const num = T * a.n;
  return { q: floorDiv(num, a.d), r: floorMod(num, a.d) };
}
