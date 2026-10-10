/**
 * Deterministic integer PRNG for the invariant tests (xorshift32; Marsaglia 2003). Integer-only:
 * no Math.random, no floats, so the waris lint rules hold here too. The seed is recorded in every
 * report so any failing family can be regenerated exactly.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Next uint32. */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }

  /** Uniform-enough integer in [0, n). */
  int(n: number): number {
    if (n <= 1) return 0;
    return this.next() % n;
  }

  /** true with probability pct/100 (pct an integer 0–100). */
  chance(pct: number): boolean {
    return this.int(100) < pct;
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }

  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }
}
