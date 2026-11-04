"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { countVisit, jakartaDay, parseVisitMemory, sectionOf, viewOnly, type VisitReport } from "./visit-count";

const KEY = "belajar:v1:kunjungan";

/**
 * Counts this page view, once per address, anonymously (./visit-count.ts). Draws nothing, is never waited on,
 * and a count that fails is not worth an error. Opening another page of the list (?hal=) is the same address.
 */
export function VisitCount() {
  const pathname = usePathname();
  useEffect(() => {
    const section = sectionOf(pathname);
    if (!section) return;
    let report: VisitReport = viewOnly(section);
    try {
      const counted = countVisit(parseVisitMemory(window.localStorage.getItem(KEY)), section, jakartaDay(new Date()));
      window.localStorage.setItem(KEY, JSON.stringify(counted.memory));
      report = counted.report;
    } catch {
      // Blocked storage: a page view, and no visitor (viewOnly).
    }
    try {
      navigator.sendBeacon("/belajar/api/kunjungan", new Blob([JSON.stringify(report)], { type: "application/json" }));
    } catch {
      // A count is not worth an error.
    }
  }, [pathname]);
  return null;
}
