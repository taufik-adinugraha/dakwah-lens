"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CornerDownRight,
  MessageSquare,
  Pencil,
  Pin,
  Send,
  Trash2,
} from "lucide-react";

import { localeAwareFormatDateTime } from "@/lib/date-id";
import { deleteComment } from "@/app/[locale]/admin/system/actions";

type ReplyItem = {
  id: string;
  displayName: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
};

type CommentItem = {
  id: string;
  displayName: string;
  body: string;
  /** ISO 8601 string — Dates don't cross the server/client boundary. */
  createdAt: string;
  pinned?: boolean;
  /** ISO 8601 of last poster edit, or null/undefined if never edited. */
  editedAt?: string | null;
  /** Server-provided count of approved replies. Only meaningful on
   *  top-level rows (reply rows themselves can't be replied to). */
  replyCount?: number;
  /** Approved replies under this top-level row. Rendered inline
   *  (no collapse) so a moderator scanning the thread doesn't miss
   *  approved content hidden behind a toggle. Server-fetched. */
  replies?: ReplyItem[];
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
  edit: string;
  editSave: string;
  editSaving: string;
  editCancel: string;
  editLabel: string;
  editWindowHint: string;
  editSuccess: string;
  editSuccessPending: string;
  editErrorWindow: string;
  editErrorLimit: string;
  editErrorForbidden: string;
  reply: string;
  replyBodyPlaceholder: string;
  replySend: string;
  replySending: string;
  replyCancel: string;
  replyCountOne: string;
  /** Plural form with `{count}` placeholder. */
  replyCountMany: string;
  repliesShow: string;
  repliesHide: string;
  repliesLoading: string;
  repliesEmpty: string;
  modDelete: string;
  modDeleteConfirm: string;
};

/** Must match EDIT_WINDOW_MINUTES in the PATCH route. UI uses this to
 *  decide whether to show the pencil — server is still the source of
 *  truth and rejects late edits with 410. */
const EDIT_WINDOW_MS = 15 * 60_000;
/** localStorage key holding `{ [commentId]: createdAtEpochMs }` so we
 *  can show the pencil only on rows this visitor authored. Pruned on
 *  each write to keep growth bounded. */
const OWNED_KEY = "dl_owned";

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
  viewerCanModerate = false,
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
  /** When true (server-decided based on the viewer's role), every
   *  comment + reply gets an inline Delete button that calls the
   *  same `deleteComment` server action used by the admin
   *  moderation page. */
  viewerCanModerate?: boolean;
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

  // Map of commentId → ownership marker. Hydrated from localStorage on
  // mount so a returning visitor keeps the pencil on rows they wrote.
  // Server still gates edits via the httpOnly cookie — this is purely
  // UI: showing the pencil to someone who doesn't actually own the row
  // just gets them a 403 if they try.
  const [ownedIds, setOwnedIds] = useState<Set<string>>(() => new Set());

  // Inline edit state. Only one row is editable at a time — opening
  // edit on a different row replaces this.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  // `now` ticks so the edit-window check re-evaluates without us
  // calling Date.now() during render (React's purity rule).
  const [now, setNow] = useState<number>(() => Date.now());

  // Reply form state — at most one inline reply form is open at a time.
  // Reply name re-uses the top-level name (hydrated from localStorage)
  // by default so the visitor doesn't re-type their identity.
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);

  // Replies are server-rendered inline under each top-level row.
  // Client-side state only tracks newly-submitted replies that need
  // to be appended optimistically before the next page revalidation
  // ships down a fresh server-render with the new row attached.
  const [extraRepliesByParent, setExtraRepliesByParent] = useState<
    Record<string, ReplyItem[]>
  >({});

  useEffect(() => {
    hydrateOwnership({ setOwnedIds });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rememberOwnership = useCallback((commentId: string) => {
    setOwnedIds((prev) => {
      if (prev.has(commentId)) return prev;
      const next = new Set(prev);
      next.add(commentId);
      return next;
    });
    try {
      const raw = window.localStorage.getItem(OWNED_KEY) ?? "{}";
      const map = JSON.parse(raw) as Record<string, number>;
      map[commentId] = Date.now();
      window.localStorage.setItem(OWNED_KEY, JSON.stringify(map));
    } catch {
      /* storage unavailable — keep going */
    }
  }, []);

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
          id?: string | null;
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
          // Server returned the real id for an approved row — use it
          // so the in-place edit pencil works immediately without a
          // page reload. Fall back to a local id when missing (older
          // server, or some edge case).
          const newId = data.id ?? `local-${Date.now()}`;
          if (data.id) rememberOwnership(data.id);
          // Optimistically prepend to the list so the writer sees
          // their own comment immediately — saves one full reload.
          setItems((prev) => [
            {
              id: newId,
              displayName: trimmedName,
              body: trimmedBody,
              createdAt: new Date().toISOString(),
              editedAt: null,
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
    [
      submitting,
      name,
      body,
      briefingSlug,
      labels,
      submitToken,
      hp,
      email,
      notifyMe,
      rememberOwnership,
    ],
  );

  const openEdit = useCallback((c: CommentItem) => {
    setEditingId(c.id);
    setEditBody(c.body);
    setNotice(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditBody("");
  }, []);

  const saveEdit = useCallback(
    async (commentId: string) => {
      if (editSubmitting) return;
      const trimmed = editBody.trim();
      if (trimmed.length < 2) {
        setNotice({ tone: "error", message: labels.errorInvalid });
        return;
      }
      setEditSubmitting(true);
      setNotice(null);
      try {
        const r = await fetch(
          `/api/m/${encodeURIComponent(briefingSlug)}/comments/${encodeURIComponent(
            commentId,
          )}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ body: trimmed }),
          },
        );
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          error?: string;
          editedAt?: string;
          noop?: boolean;
        };
        if (r.status === 410 || data.error === "window_closed") {
          setNotice({ tone: "warn", message: labels.editErrorWindow });
          // Pencil is now wrong-state; drop ownership so it disappears.
          setOwnedIds((prev) => {
            const next = new Set(prev);
            next.delete(commentId);
            return next;
          });
          cancelEdit();
          return;
        }
        if (r.status === 403 || data.error === "forbidden") {
          setNotice({ tone: "error", message: labels.editErrorForbidden });
          return;
        }
        if (data.error === "edit_limit") {
          setNotice({ tone: "warn", message: labels.editErrorLimit });
          return;
        }
        if (r.status === 429) {
          setNotice({ tone: "warn", message: labels.errorRate });
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
          // Re-moderation demoted the row — strip it from the visible
          // list (it's now `status='blocked'` server-side) and tell the
          // user what happened.
          setItems((prev) => prev.filter((c) => c.id !== commentId));
          setOwnedIds((prev) => {
            const next = new Set(prev);
            next.delete(commentId);
            return next;
          });
          setNotice({ tone: "warn", message: labels.editSuccessPending });
        } else {
          setItems((prev) =>
            prev.map((c) =>
              c.id === commentId
                ? {
                    ...c,
                    body: trimmed,
                    editedAt: data.editedAt ?? new Date().toISOString(),
                  }
                : c,
            ),
          );
          setNotice({ tone: "success", message: labels.editSuccess });
        }
        cancelEdit();
      } catch {
        setNotice({ tone: "error", message: labels.errorGeneric });
      } finally {
        setEditSubmitting(false);
      }
    },
    [editSubmitting, editBody, briefingSlug, labels, cancelEdit],
  );

  const openReply = useCallback((parentId: string) => {
    setReplyingToId(parentId);
    setReplyBody("");
    setNotice(null);
    setEditingId(null);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingToId(null);
    setReplyBody("");
  }, []);

  const submitReply = useCallback(
    async (parentId: string) => {
      if (replySubmitting) return;
      const trimmedName = name.trim();
      const trimmedBody = replyBody.trim();
      if (trimmedName.length < 2 || trimmedBody.length < 2) {
        setNotice({ tone: "error", message: labels.errorInvalid });
        return;
      }
      setReplySubmitting(true);
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
              parent_id: parentId,
              dl_url_check: hp,
            }),
          },
        );
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          error?: string;
          id?: string | null;
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
              data.error === "invalid"
                ? labels.errorInvalid
                : labels.errorGeneric,
          });
          return;
        }
        if (data.status === "pending") {
          setNotice({ tone: "warn", message: labels.successPending });
          cancelReply();
          return;
        }
        // Approved — optimistically append to the inline replies
        // bucket for this parent so the new comment appears under
        // its target right away. The next server-render will pick
        // it up via the inline-replies query and the bucket can be
        // dropped on hydration; until then this keeps the UI honest.
        const newId = data.id ?? `local-${Date.now()}`;
        if (data.id) rememberOwnership(data.id);
        const newReply: ReplyItem = {
          id: newId,
          displayName: trimmedName,
          body: trimmedBody,
          createdAt: new Date().toISOString(),
          editedAt: null,
        };
        setExtraRepliesByParent((m) => ({
          ...m,
          [parentId]: [...(m[parentId] ?? []), newReply],
        }));
        setItems((prev) =>
          prev.map((c) =>
            c.id === parentId
              ? { ...c, replyCount: (c.replyCount ?? 0) + 1 }
              : c,
          ),
        );
        try {
          window.localStorage.setItem("dl_dn", trimmedName);
        } catch {
          /* storage unavailable — keep going */
        }
        setNotice({ tone: "success", message: labels.successPublished });
        cancelReply();
      } catch {
        setNotice({ tone: "error", message: labels.errorGeneric });
      } finally {
        setReplySubmitting(false);
      }
    },
    [
      replySubmitting,
      name,
      replyBody,
      briefingSlug,
      submitToken,
      hp,
      labels,
      cancelReply,
      rememberOwnership,
    ],
  );

  // Moderator delete — only wired when `viewerCanModerate` is true.
  // Calls the same server action /admin/system/discussion uses; the
  // server re-checks the role and audit-logs the delete. Optimistic
  // UI: pull the row from local state immediately, server
  // revalidation lands shortly after.
  const moderatorDelete = useCallback(
    async (commentId: string, parentId: string | null) => {
      if (!viewerCanModerate) return;
      if (!window.confirm(labels.modDeleteConfirm)) return;
      // Optimistic remove. If the action fails (e.g. session
      // expired) the next page revalidation puts the row back.
      if (parentId) {
        // Reply — drop from the parent's reply list + decrement
        // the parent's reply count chip if we ever render it.
        setItems((prev) =>
          prev.map((c) =>
            c.id === parentId
              ? {
                  ...c,
                  replies: (c.replies ?? []).filter((r) => r.id !== commentId),
                  replyCount: Math.max(0, (c.replyCount ?? 0) - 1),
                }
              : c,
          ),
        );
        setExtraRepliesByParent((m) => ({
          ...m,
          [parentId]: (m[parentId] ?? []).filter((r) => r.id !== commentId),
        }));
      } else {
        // Top-level — drop the whole card.
        setItems((prev) => prev.filter((c) => c.id !== commentId));
      }
      try {
        const fd = new FormData();
        fd.set("id", commentId);
        await deleteComment(fd);
      } catch (err) {
        // Action threw (network / auth) — surface a notice so the
        // moderator knows the optimistic remove may un-revert on
        // the next page load.
        console.warn("[mod-delete] action failed:", err);
        setNotice({ tone: "error", message: labels.errorGeneric });
      }
    },
    [viewerCanModerate, labels.modDeleteConfirm, labels.errorGeneric],
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
          const createdMs = new Date(c.createdAt).getTime();
          const withinWindow =
            Number.isFinite(createdMs) && now - createdMs < EDIT_WINDOW_MS;
          // Edits are only meaningful for real DB ids — skip the
          // `local-…` placeholder used in the offline-block path. Also
          // hide the pencil on admin-reply rows just in case the
          // ownership map ever gets a stray id from that path.
          const canEdit =
            ownedIds.has(c.id) &&
            !c.id.startsWith("local-") &&
            withinWindow &&
            !isAdminReply;
          const isEditingThis = editingId === c.id;
          const isReplyingHere = replyingToId === c.id;
          // Server-rendered replies + any optimistic ones added
          // since hydration. Always rendered inline (no collapse).
          const threadReplies = [
            ...(c.replies ?? []),
            ...(extraRepliesByParent[c.id] ?? []),
          ];
          const canReply = !muted && !isReplyingHere;
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
                  {c.editedAt && (
                    <span className="text-[10px] font-medium text-slate-400">
                      · {labels.editLabel}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">
                    {localeAwareFormatDateTime(new Date(c.createdAt), locale, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    })}
                  </span>
                  {canEdit && !isEditingThis && (
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                      {labels.edit}
                    </button>
                  )}
                  {viewerCanModerate && !isEditingThis && (
                    <button
                      type="button"
                      onClick={() => moderatorDelete(c.id, null)}
                      className="inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                      title={labels.modDelete}
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                      {labels.modDelete}
                    </button>
                  )}
                </div>
              </div>
              {isEditingThis ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    maxLength={BODY_MAX}
                    rows={4}
                    className="block w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 shadow-sm transition focus:outline-none focus:ring-2"
                    style={{ ["--tw-ring-color" as string]: palette.accent }}
                    autoFocus
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400">
                      {labels.editWindowHint} · {editBody.length}/{BODY_MAX}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={editSubmitting}
                        className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {labels.editCancel}
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(c.id)}
                        disabled={editSubmitting}
                        className="inline-flex h-8 items-center rounded-full px-4 text-xs font-bold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: palette.accentDeep }}
                      >
                        {editSubmitting ? labels.editSaving : labels.editSave}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap text-pretty text-[14px] leading-relaxed text-slate-700">
                  {c.body}
                </p>
              )}

              {/* Reply control — Balas button only. Reply count is
                  implicit from the rendered replies block below. */}
              {canReply && !isEditingThis && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => openReply(c.id)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    <MessageSquare className="h-3 w-3" />
                    {labels.reply}
                  </button>
                </div>
              )}

              {/* Inline reply form — name re-uses the top-level state
                  so the visitor doesn't re-type their identity. */}
              {isReplyingHere && (
                <div
                  className="mt-3 rounded-xl border-l-4 border bg-slate-50/70 p-3"
                  style={{
                    borderLeftColor: palette.accent,
                    borderColor: palette.soft + "55",
                  }}
                >
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    <CornerDownRight className="h-3 w-3" />
                    <span>{labels.reply}</span>
                    <span className="text-slate-400">·</span>
                    <span
                      className="font-bold normal-case"
                      style={{ color: palette.accentDeep }}
                    >
                      {c.displayName}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={NAME_MAX}
                    placeholder={labels.namePlaceholder}
                    autoComplete="nickname"
                    className="mb-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2"
                    style={{ ["--tw-ring-color" as string]: palette.accent }}
                    required
                    minLength={2}
                  />
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    maxLength={BODY_MAX}
                    rows={3}
                    placeholder={labels.replyBodyPlaceholder}
                    className="block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2"
                    style={{ ["--tw-ring-color" as string]: palette.accent }}
                    autoFocus
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400">
                      {replyBody.length}/{BODY_MAX}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelReply}
                        disabled={replySubmitting}
                        className="inline-flex h-8 items-center rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {labels.replyCancel}
                      </button>
                      <button
                        type="button"
                        onClick={() => submitReply(c.id)}
                        disabled={replySubmitting}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-bold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: palette.accentDeep }}
                      >
                        <Send className="h-3 w-3" />
                        {replySubmitting
                          ? labels.replySending
                          : labels.replySend}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Replies — visually offset (indent + accent left rail
                  + tinted background) so the hierarchy reads clearly
                  even without a heavy outer container. */}
              {threadReplies.length > 0 && (
                <div
                  className="mt-3 space-y-2 border-l-2 pl-4 sm:pl-5"
                  style={{ borderColor: palette.accent + "55" }}
                >
                  {threadReplies.map((r) => {
                    const replyIsAdmin = /^dakwah[\s.\-_·]*lens/i.test(
                      r.displayName,
                    );
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl border border-l-4 px-4 py-3"
                        style={{
                          borderColor: palette.soft + "60",
                          borderLeftColor: replyIsAdmin
                            ? palette.accentDeep
                            : palette.accent + "aa",
                          background: replyIsAdmin
                            ? palette.quoteBg
                            : palette.accent + "08",
                        }}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span
                            className="text-[13px] font-bold"
                            style={{ color: palette.accentDeep }}
                          >
                            {r.displayName}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {localeAwareFormatDateTime(
                              new Date(r.createdAt),
                              locale,
                              {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "Asia/Jakarta",
                              },
                            )}
                            {r.editedAt && (
                              <>
                                {" · "}
                                <span className="text-slate-400">
                                  {labels.editLabel}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-pretty text-[13px] leading-relaxed text-slate-700">
                          {r.body}
                        </p>
                        {viewerCanModerate && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => moderatorDelete(r.id, c.id)}
                              className="inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                              title={labels.modDelete}
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                              {labels.modDelete}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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

/**
 * Hydrate the owned-comments map from localStorage and push it into
 * React state. Extracted from the post-mount effect for the same
 * cascade-render-lint reason — the read + prune + setState pattern is
 * a deliberate one-shot hydration.
 */
function hydrateOwnership({
  setOwnedIds,
}: {
  setOwnedIds: (s: Set<string>) => void;
}): void {
  try {
    const raw = window.localStorage.getItem(OWNED_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, number>;
    const next = new Set<string>();
    const pruneCutoff = Date.now() - 7 * 24 * 60 * 60_000;
    let changed = false;
    for (const [cid, ts] of Object.entries(map)) {
      if (!Number.isFinite(ts) || ts < pruneCutoff) {
        delete map[cid];
        changed = true;
        continue;
      }
      next.add(cid);
    }
    if (changed) window.localStorage.setItem(OWNED_KEY, JSON.stringify(map));
    setOwnedIds(next);
  } catch {
    /* storage unavailable — silent no-op */
  }
}
