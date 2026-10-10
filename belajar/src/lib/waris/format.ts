/**
 * Display formatting only (engine.md §14 step 4). The ONLY waris module exempt from the
 * no-float lint rules — and it still needs none: percent is computed on bigint.
 * The fraction is the legal share; percent and rupiah are conveniences.
 */
import { B0, B1, B100, floorDiv, floorMod, type Frac } from "./frac";

/** 100 × n/d rounded half-up to 2 decimals, Indonesian decimal comma: "16,67". */
export function percent(f: Frac): string {
  const scaled = f.n * B100 * B100; // hundredths of a percent × d
  const two = BigInt(2);
  const q = floorDiv(scaled * two + f.d, f.d * two); // round half up
  const neg = q < B0;
  const abs = neg ? -q : q;
  const whole = floorDiv(abs, B100);
  const cents = floorMod(abs, B100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toString()},${cents}`;
}

/** "Rp 16.666.667" (dot thousands separators). */
export function rupiah(x: bigint): string {
  const neg = x < B0;
  const s = (neg ? -x : x).toString();
  const groups: string[] = [];
  for (let end = s.length; end > 0; end -= 3) groups.unshift(s.slice(end - 3 < 0 ? 0 : end - 3, end));
  return `${neg ? "-" : ""}Rp ${groups.join(".")}`;
}

/** "a/b" with a proper fraction slash for print; "1" for the whole. */
export function fraction(f: Frac): string {
  return f.d === B1 ? f.n.toString() : `${f.n.toString()}/${f.d.toString()}`;
}
