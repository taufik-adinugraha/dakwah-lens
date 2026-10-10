"use client";

import { createContext, useContext, type MouseEvent } from "react";

import type { DalilCard } from "@/lib/waris/report";

/** Every dalil card of the current report, by record id (for "Lihat dalil" links). */
export const CardsContext = createContext<ReadonlyMap<string, DalilCard>>(new Map());

export function useCards(): ReadonlyMap<string, DalilCard> {
  return useContext(CardsContext);
}

/** DOM id of a dalil card ("dalil-Q-4-11"). */
export const cardAnchor = (id: string) => `dalil-${id.replace(/[^A-Za-z0-9_-]+/g, "-")}`;

/**
 * Follow an in-report link without touching location.hash (a share link's answers live in the
 * hash, plan D9): open every enclosing <details>, scroll there, and move focus to it.
 */
export function revealTarget(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  for (let p: HTMLElement | null = el; p; p = p.parentElement) {
    if (p instanceof HTMLDetailsElement) p.open = true;
  }
  let reduce = false;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    reduce = false;
  }
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const target = el instanceof HTMLDetailsElement ? el.querySelector("summary") : el;
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}
