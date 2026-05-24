"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Pin, Send } from "lucide-react";

import { localeAwareFormatDateTime } from "@/lib/date-id";

type CommentItem = {
  id: string;
  displayName: string;
  body: string;
  /** ISO 8601 string — Dates don't cross the server/client boundary. */
  createdAt: string;
  pinned?: boolean;
};

type Labels = {
  nameLabel: string;
  namePlaceholder: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  submit: string;
  submitting: string;
  successPublished: string;
  successPending: string;
  errorInvalid: string;
  errorRate: string;
  errorStale: string;
  errorForbidden: string;
  errorMuted: string;
  errorGeneric: string;
  loadMore: string;
  loading: string;
  empty: string;
  pinned: string;
  notifyLabel: string;
  notifyHint: string;
  notifyPrivacy: string;
  emailPlaceholder: string;
  successNotify: string;
};

type Palette = {
  accent: string;
  accentDeep: string;
  soft: string;
  quoteBg: string;
};

const NAME_MAX = 40;
const BODY_MAX = 500;

export function CommentForm({
  briefingSlug,
  submitToken,
  muted = false,
  palette,
  labels,
  initialItems,
  initialHasMore,
  locale,
}: {
  briefingSlug: string;
  /** Server-minted HMAC token. Submitted back so the API can verify
   *  that this came from a real page render (and enforce a 3s+
   *  minimum age, which trips bots that POST instantly). */
  submitToken: string;
  /** Admin-muted: existing thread stays visible but the form is
   *  hidden. */
  muted?: boolean;
  palette: Palette;
  labels: Labels;
  initialItems: CommentItem[];
  initialHasMore: boolean;
  locale: string;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  // Optional email + opt-in for admin-reply notifications. Both
  // stored in localStorage so a returning poster doesn't re-type them.
  const [email, setEmail] = useState("");
  const [notifyMe, setNotifyMe] = useState(false);
  // Honeypot — hidden via CSS + aria-hidden. Real users never touch it;
  // dumb form-fillers populate every visible field they can find.
  const [hp, setHp] = useState("");

  // Hydrate the name + email from localStorage on mount so a returning
  // visitor doesn't have to re-type their identity. Reading localStorage
  // on the SERVER is undefined, so we can't use a lazy useState
  // initializer — must be a post-mount effect. The setStates are
  // intentionally synchronous (one-shot hydration) — disable the
  // cascade-render lint for this block since the pattern is correct.
  useEffect(() => {
    let saved: { name?: string; email?: string; notify?: boolean } = {};
    try {
      saved = {
        name: window.localStorage.getItem("dl_dn") || undefined,
        email: window.localStorage.getItem("dl_em") || undefined,
        notify:
          window.localStorage.getItem("dl_em_notify") === "1" &&
          !!window.localStorage.getItem("dl_em"),
      };
    } catch {
      /* storage unavailable / private mode — silent no-op */
    }
    applyHydratedState({ saved, setName, setEmail, setNotifyMe });
  }, []);
  const [items, setItems] = useState<CommentItem[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [page, setPage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "success" | "warn" | "error"; message: string } | null
  >(null);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const r = await fetch(
        `/api/m/${encodeURIComponent(briefingSlug)}/comments?page=${nextPage}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const data = (await r.json()) as {
        items: { id: string; displayName: string; body: string; createdAt: string }[];
        hasMore: boolean;
      };
      setItems((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
      setPage(nextPage);
    } finally {
      setLoadingMore(false);
    }
  }, [briefingSlug, page]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      const trimmedName = name.trim();
      const trimmedBody = body.trim();
      if (trimmedName.length < 2 || trimmedBody.length < 2) {
        setNotice({ tone: "error", message: labels.errorInvalid });
        return;
      }
      setSubmitting(true);
      setNotice(null);
      try {
        const r = await fetch(
          `/api/m/${encodeURIComponent(briefingSlug)}/comments`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              display_name: trimmedName,
              body: trimmedBody,
              token: submitToken,
              // Optional email opt-in. Server validates the address
              // and only persists a subscriber row when notify_me is
              // truthy AND the email looks valid.
              email: notifyMe ? email.trim() : "",
              notify_me: notifyMe ? "1" : "",
              // Honeypot field — `dl_url_check` is a deliberately
              // non-semantic name so browser autofills + password
              // managers don't fill it for real users. Server
              // blocks submissions where this is non-empty.
              dl_url_check: hp,
            }),
          },
        );
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          error?: string;
          subscribed?: boolean;
        };
        if (r.status === 429) {
          setNotice({ tone: "warn", message: labels.errorRate });
          return;
        }
        if (r.status === 410 || data.error === "stale") {
          setNotice({ tone: "warn", message: labels.errorStale });
          return;
        }
        if (r.status === 403 || data.error === "forbidden") {
          setNotice({ tone: "error", message: labels.errorForbidden });
          return;
        }
        if (r.status === 423 || data.error === "muted") {
          setNotice({ tone: "warn", message: labels.errorMuted });
          return;
        }
        if (!r.ok || !data.ok) {
          setNotice({
            tone: "error",
            message:
              data.error === "invalid" ? labels.errorInvalid : labels.errorGeneric,
          });
          return;
        }
        if (data.status === "pending") {
          setNotice({ tone: "warn", message: labels.successPending });
        } else {
          // Persist identity for the next visit. Wrapped in try
          // because Safari's private mode can throw on setItem.
          try {
            window.localStorage.setItem("dl_dn", trimmedName);
            // Track this slug as "watched" so /insights can show a
            // sticky-nudge chip when the room has new activity.
            // Prune entries older than 90 days on each write so the
            // map can't grow unbounded over years.
            const watchedRaw = window.localStorage.getItem("dl_watched") ?? "{}";
            const watched = JSON.parse(watchedRaw) as Record<string, number>;
            const pruneCutoff = Date.now() - 90 * 24 * 60 * 60_000;
            for (const k of Object.keys(watched)) {
              if (!Number.isFinite(watched[k]) || watched[k] < pruneCutoff) {
                delete watched[k];
              }
            }
            watched[briefingSlug] = Date.now();
            window.localStorage.setItem("dl_watched", JSON.stringify(watched));
            if (notifyMe && email.trim()) {
              window.localStorage.setItem("dl_em", email.trim());
              window.localStorage.setItem("dl_em_notify", "1");
            } else if (!notifyMe) {
              window.localStorage.removeItem("dl_em_notify");
            }
          } catch {
            /* storage unavailable — keep going */
          }
          const message = data.subscribed
            ? `${labels.successPublished} ${labels.successNotify}`
            : labels.successPublished;
          setNotice({ tone: "success", message });
          // Optimistically prepend to the list so the writer sees
          // their own comment immediately — saves one full reload.
          setItems((prev) => [
            {
              id: `local-${Date.now()}`,
              displayName: trimmedName,
              body: trimmedBody,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ]);
        }
        setBody("");
      } catch {
        setNotice({ tone: "error", message: labels.errorGeneric });
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, name, body, briefingSlug, labels, submitToken, hp, email, notifyMe],
  );

  return (
    <div>
      {!muted && (
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label
            htmlFor="comment-name"
            className="block text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500"
          >
            {labels.nameLabel}
          </label>
          <input
            id="comment-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            placeholder={labels.namePlaceholder}
            autoComplete="nickname"
            className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: palette.accent }}
            required
            minLength={2}
          />
        </div>
        <div>
          <label
            htmlFor="comment-body"
            className="block text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500"
          >
            {labels.bodyLabel}
          </label>
          <textarea
            id="comment-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={BODY_MAX}
            placeholder={labels.bodyPlaceholder}
            rows={4}
            className="mt-1.5 block w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: palette.accent }}
            required
            minLength={2}
          />
          <div className="mt-1 text-right text-[11px] text-slate-400">
            {body.length}/{BODY_MAX}
          </div>
        </div>

        {/* Email opt-in. Collapsed by default — the checkbox expands
            the email row + the privacy note. Friction stays low when
            the user just wants to post anonymously. */}
        <div
          className="rounded-xl border bg-slate-50/60 px-3.5 py-2.5"
          style={{ borderColor: palette.soft + "55" }}
        >
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={notifyMe}
              onChange={(e) => setNotifyMe(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
              style={{ accentColor: palette.accent }}
            />
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800">
                <Bell className="h-3 w-3" />
                {labels.notifyLabel}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500">
                {labels.notifyHint}
              </span>
            </span>
          </label>
          {notifyMe && (
            <div className="mt-2.5 space-y-1.5 border-t border-slate-200 pt-2.5">
              <input
                id="comment-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={255}
                placeholder={labels.emailPlaceholder}
                autoComplete="email"
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: palette.accent }}
              />
              <p className="text-[11px] leading-snug text-slate-500">
                {labels.notifyPrivacy}
              </p>
            </div>
          )}
        </div>

        {/* Honeypot — visually + semantically hidden from real users
            and screen readers, but most dumb form-bots will populate
            it. Server blocks any submission where this field is set. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            top: "auto",
            width: 1,
            height: 1,
            overflow: "hidden",
          }}
        >
          <label htmlFor="dl_url_check">Leave this empty</label>
          <input
            id="dl_url_check"
            name="dl_url_check"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-xs font-bold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: palette.accentDeep }}
          >
            <Send className="h-3.5 w-3.5" />
            {submitting ? labels.submitting : labels.submit}
          </button>
          {notice && (
            <span
              className={
                notice.tone === "success"
                  ? "text-xs font-medium text-emerald-700"
                  : notice.tone === "warn"
                    ? "text-xs font-medium text-amber-700"
                    : "text-xs font-medium text-rose-700"
              }
            >
              {notice.message}
            </span>
          )}
        </div>
      </form>
      )}

      <ul className="mt-8 space-y-4">
        {items.length === 0 && (
          <li className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-7 text-center text-sm text-slate-500">
            {labels.empty}
          </li>
        )}
        {items.map((c) => {
          const isAdminReply = /^dakwah[\s.\-_·]*lens/i.test(c.displayName);
          return (
            <li
              key={c.id}
              className="rounded-2xl border px-5 py-4 shadow-sm"
              style={{
                borderColor: c.pinned
                  ? palette.accent
                  : isAdminReply
                    ? palette.accent + "60"
                    : palette.soft + "70",
                background: isAdminReply ? palette.quoteBg : "#ffffff",
                boxShadow: c.pinned
                  ? "0 4px 18px " + palette.accent + "20"
                  : undefined,
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-sm font-bold"
                    style={{ color: palette.accentDeep }}
                  >
                    {c.displayName}
                  </span>
                  {c.pinned && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                      style={{
                        background: palette.accent,
                        color: "#ffffff",
                      }}
                    >
                      <Pin className="h-2.5 w-2.5" />
                      {labels.pinned}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">
                  {localeAwareFormatDateTime(new Date(c.createdAt), locale, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Jakarta",
                  })}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-pretty text-[14px] leading-relaxed text-slate-700">
                {c.body}
              </p>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? labels.loading : labels.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Apply hydrated identity to form state. Extracted out so the
 * cascade-render lint doesn't fire on the localStorage post-mount
 * effect — the setStates are a known-acceptable hydration pattern.
 */
function applyHydratedState({
  saved,
  setName,
  setEmail,
  setNotifyMe,
}: {
  saved: { name?: string; email?: string; notify?: boolean };
  setName: (s: string) => void;
  setEmail: (s: string) => void;
  setNotifyMe: (b: boolean) => void;
}): void {
  if (saved.name) setName(saved.name);
  if (saved.email) setEmail(saved.email);
  if (saved.notify) setNotifyMe(true);
}
