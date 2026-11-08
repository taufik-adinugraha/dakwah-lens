"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { arrivalOf, countVisit, jakartaDay, optOutRequest, parseVisitMemory, sectionOf, viewOnly, type VisitReport } from "./visit-count";

const KEY = "belajar:v1:kunjungan";
/** Set by `?kunjungan=tidak` and cleared by `?kunjungan=ya`: this browser is left out of the counts. */
const OPT_OUT_KEY = "belajar:v1:kunjungan-tidak";

/**
 * Counts this page view, once per address, anonymously (./visit-count.ts). Draws nothing, is never waited on,
 * and a count that fails is not worth an error. Opening another page of the list (?hal=) is the same address.
 *
 * Two things beyond the count (operator 2026-11-08): the first page view of a visit says where it came from
 * (the homepage's Belajar button, another page of the main site, or elsewhere; every later one says
 * "elsewhere", because the referrer stays the same through the visit), and an address with
 * `?kunjungan=tidak` leaves this browser out of the counts until `?kunjungan=ya`, so the owner's own devices
 * need not show up. The choice lives in this browser only.
 */
export function VisitCount() {
  const pathname = usePathname();
  const landing = useRef(true);
  useEffect(() => {
    const first = landing.current;
    landing.current = false;
    // Ilmu Waris and a mistyped address do nothing at all: not even a look at the browser's storage.
    const section = sectionOf(pathname);
    if (!section) return;
    try {
      const ask = optOutRequest(window.location.search);
      if (ask === "off") window.localStorage.setItem(OPT_OUT_KEY, "1");
      if (ask === "on") window.localStorage.removeItem(OPT_OUT_KEY);
      if (window.localStorage.getItem(OPT_OUT_KEY) === "1") return;
    } catch {
      // Blocked storage: the choice cannot be kept, so the page is counted as usual.
    }
    const arrival = first
      ? arrivalOf({
          referrer: document.referrer,
          origin: window.location.origin,
          navigationType: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type,
          search: window.location.search,
        })
      : "other";
    let report: VisitReport = viewOnly(section, arrival);
    try {
      const counted = countVisit(parseVisitMemory(window.localStorage.getItem(KEY)), section, jakartaDay(new Date()), arrival);
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
