"use client";

import { useEffect } from "react";

import { watchLines } from "@/lib/lineFit";

/**
 * Kept-together text wider than its line breaks in the paragraph's flow
 * instead of taking the whole line (src/lib/lineFit.ts). Once per page, in
 * the locale layout; renders nothing.
 */
export function LineFit() {
  useEffect(() => watchLines(document), []);
  return null;
}
