"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { Sparkles, BarChart3 } from "lucide-react";

/**
 * Two-mode dashboard: "kit" (consumers — da'i, ustadzah, parents who
 * want ready-to-use content) and "data" (researchers — people watching
 * the social-listening signal). Tab choice persists in localStorage
 * under `dashboard.tab` so a return visit lands on the user's last
 * picked mode.
 *
 * Renders both panels mounted; CSS hides the inactive one. This means
 * a tab switch is instant (no re-fetch) since the server already loaded
 * both panels' data. Trade-off: ~2x payload on first load, but Next.js
 * RSC and the dashboard's data volume keep that under 50KB extra.
 *
 * Why client-side persistence (not a DB column): the choice is a UX
 * preference, not a security boundary. localStorage avoids a migration
 * + an API call on first paint + a Settings page to expose the toggle.
 * If we later add a profile-level preference (e.g. "default to data
 * mode for journalists"), we can layer that on top by seeding the
 * initial tab from the server.
 */

type Tab = "kit" | "data";

const STORAGE_KEY = "dashboard.tab";
const TAB_CHANGE_EVENT = "dashboard-tab:change";

/**
 * Subscribe to localStorage for THIS key. Cross-tab updates fire the
 * native `storage` event; same-tab updates need a synthetic event since
 * the platform doesn't dispatch one to its own window.
 */
function subscribeTab(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(TAB_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(TAB_CHANGE_EVENT, callback);
  };
}

function getTabSnapshot(): Tab {
  if (typeof window === "undefined") return "kit";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "data" || v === "kit" ? v : "kit";
  } catch {
    return "kit";
  }
}

// SSR + first client paint both render "kit" (matches SSR snapshot),
// then useSyncExternalStore swaps to the persisted value after
// hydration. No setState-in-effect needed — React handles the
// post-hydration transition.
const getServerTabSnapshot = (): Tab => "kit";

export function DashboardTabs({
  kit,
  data,
  labels,
}: {
  kit: ReactNode;
  data: ReactNode;
  labels: {
    kit: string;
    kit_subtitle: string;
    data: string;
    data_subtitle: string;
  };
}) {
  const tab = useSyncExternalStore(
    subscribeTab,
    getTabSnapshot,
    getServerTabSnapshot,
  );

  const pick = useCallback((next: Tab) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      // Same-window update — the native `storage` event only fires
      // cross-tab, so we kick our synthetic event so the local
      // subscriber re-snapshots immediately.
      window.dispatchEvent(new Event(TAB_CHANGE_EVENT));
    } catch {
      // localStorage disabled — silent
    }
  }, []);

  return (
    <div className="mt-6">
      {/* Sticky tab strip — keeps the mode switcher reachable while
          the user scrolls through long content like the khutbah excerpt. */}
      <div
        role="tablist"
        aria-label="Dashboard mode"
        className="sticky top-16 z-20 -mx-4 mb-6 flex gap-2 border-b border-slate-200/70 bg-white/85 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6"
      >
        <TabButton
          active={tab === "kit"}
          onClick={() => pick("kit")}
          icon={<Sparkles className="h-4 w-4" />}
          label={labels.kit}
          subtitle={labels.kit_subtitle}
        />
        <TabButton
          active={tab === "data"}
          onClick={() => pick("data")}
          icon={<BarChart3 className="h-4 w-4" />}
          label={labels.data}
          subtitle={labels.data_subtitle}
        />
      </div>

      {/* `useSyncExternalStore` returns the SSR snapshot ("kit") for
          both server render and first client paint, then swaps to the
          persisted value after hydration. React handles that transition
          without a manual `hydrated` flag. `hidden` (not display:none
          directly) plays nicely with internal links + screen readers. */}
      <div
        role="tabpanel"
        aria-hidden={tab !== "kit"}
        hidden={tab !== "kit"}
      >
        {kit}
      </div>
      <div
        role="tabpanel"
        aria-hidden={tab !== "data"}
        hidden={tab !== "data"}
      >
        {data}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  subtitle: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "group flex flex-1 items-start gap-3 rounded-xl px-3 py-2 text-left transition " +
        (active
          ? "bg-slate-900 text-white shadow-md"
          : "text-slate-700 hover:bg-slate-100")
      }
    >
      <span
        className={
          "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg " +
          (active
            ? "bg-white/10 text-white"
            : "bg-slate-100 text-slate-600 group-hover:bg-slate-200")
        }
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">
          {label}
        </span>
        <span
          className={
            "block truncate text-[11px] leading-tight " +
            (active ? "text-white/70" : "text-slate-500")
          }
        >
          {subtitle}
        </span>
      </span>
    </button>
  );
}
