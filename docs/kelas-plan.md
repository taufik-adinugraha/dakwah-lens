# Open Class ("Kelas") — Product Plan

- **Status:** Plan / proposal v0.1 — locked decisions, no code yet
- **Date:** 2026-07-08
- **Owner:** Sukses & Berkah Group · Author: Taufik Adi
- **Scope of this document:** what to build, how it separates from the existing platform, compartmentalized module specs, payment approach, MVP boundary, evaluation criteria, risks, and the non-engineering critical path. Design-only.

---

## 1. Executive summary

A **paid, cohort-based Islamic-studies class platform** (Arabic language, tahsin, fiqh, kitab study, etc.), built as a **module inside the existing dakwah-lens monorepo**. Classes are taught live by **in-house ustadz on honorarium**, delivered over **Zoom (auto-created via API)**, with **public self-serve registration and payment**. The platform handles registration, scheduling, and the administrative work around each cohort.

**North star: sustainable revenue.** The feature is **self-funding** — course fees cover its own Zoom / WhatsApp / payment-processing costs, tracked as a separate P&L line and *not* charged against the intelligence-product cost cap.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | North star | **Sustainable revenue** |
| 2 | Monetization | **Paid per course** (one-time fee per cohort) |
| 3 | Architecture | **Module inside the existing monorepo** (shared identity + shell) |
| 4 | Delivery model | **Cohort / term-based** (fixed start, scheduled session series) |
| 5 | Ustadz model | **In-house honorarium** (flat fee per session; no revenue-share ledger) |
| 6 | Students | **Public open registration** (self-serve) |
| 7 | Zoom | **API auto-create** meeting rooms per cohort/session |
| 8 | Admin v1 | **Attendance + Certificates + Reminders + Materials** (all four) |
| 9 | Comms | **WhatsApp primary** (receipts/certificates may use email) |
| 10 | Payment | **Bank transfer with auto-reconciliation (Virtual Account)** |
| 11 | Segmentation | **Configurable per class**: ikhwan / akhwat / mixed |
| 12 | Budget | **Self-funding** (separate P&L, not under the IDR 1.5–2M intelligence cap) |
| 13 | Enrollment model | **New `enrollments` domain** (do NOT reuse `org_members`) |
| 14 | Access gate | **Auto-grant on confirmed payment** (bypass the pending→admin-approval flow) |
| 15 | Payment rollout | **VA auto-sync from the start** (manual transfer only as optional fallback) |
| 16 | First milestone | **Full-v1 before launch** (all four admin capabilities complete) |
| 17 | VA provider type | **Aggregator VA** — recommended **Midtrans** (Xendit fallback); provider finalized at procurement. Migrate to a direct bank VA (PKS) later if volume justifies. |

---

## 3. Separation from existing features — overlap vs. new

**Verdict: a new, self-contained domain *inside* the same app — not a separate product, ~15% overlap.** The existing platform is an *analytical / content-generation* engine (ingest → classify → weekly briefings → kitab search → audio). The class platform is an *operational / transactional* system (enroll → pay → schedule → teach live → track). They share *foundations* but almost **no business logic**.

### The three seams where the two domains touch

1. **User identity** — shared NextAuth `users` login.
2. **Kitab corpus (Qdrant)** — *optional*: a class's materials can link to real, retrieved kitab passages (reuses trusted retrieval; never invented — see §8 sharia rule).
3. **Web shell + admin patterns + Celery + email infra** — reused plumbing.

Everything else lives in an isolated `kelas`/`courses` domain, is **feature-flaggable**, and could be split into its own service later without touching the briefing pipeline.

### Reuse map (grounded in the codebase)

| Foundation | Verdict | Notes |
|---|---|---|
| NextAuth identity (email + Google) — `web/src/auth.ts` | ✅ Reuse | Needs an **approval bypass** for paid students (decision #14) |
| Web shell, i18n `[locale]` routes, design system | ✅ Reuse | Add `/kelas`, `/kelas/[slug]`, `/admin/kelas` |
| Celery beat scheduler — `api/src/api/workers/celery_app.py` | ✅ Reuse | Reminder + attendance jobs (WIB, Redis-backed) |
| Email (Resend, 3K/mo free) — `api/src/api/services/email_digest.py` | ✅ Reuse | Receipts + certificate delivery |
| Cost tracking `usage_events`; finance page `donations` | ✅ Mirror | Track class tool-costs + revenue the same way |
| Admin console pattern — `web/src/app/[locale]/admin/system/*` | ✅ Extend | New `/admin/kelas` |
| Alembic (API) + Drizzle mirror (web) migrations | ✅ Reuse | New tables integrate cleanly |
| `org_members` multi-tenancy | ⚠️ **Do NOT reuse for enrollment** | Orgs = briefing tenants; enrollment is a different relation (decision #13) |
| Payments / Zoom / WhatsApp / course models | ❌ Net-new | Greenfield — no such code exists anywhere today |

---

## 4. Compartmentalized module specs

Each module is a self-contained spec with its own tables and boundary. Arrows = hard dependencies. All modules ship before launch (decision #16), but they are built and tested independently.

- **M1 · Catalog** — `courses` + `cohorts` models; public catalog + course-detail pages. *Read-only public. No deps.*
- **M2 · Enrollment & Seats** — new `enrollments` state machine (`pending_payment → confirmed → completed / cancelled`); seat caps (hard invariant); **ikhwan/akhwat/mixed** validation against student gender. *Deps: M1.*
- **M3 · Payments — Virtual Account (aggregator)** — `orders` / `invoices`; issue a unique VA per order via aggregator; **webhook auto-confirms** payment → flips M2 to `confirmed` → auto-grants access (decision #14). Optional manual-transfer + proof-upload fallback for out-of-network banks. *Deps: M2.*
- **M4 · Scheduling** — `cohort_sessions` series; WIB calendar; reschedule. *Deps: M1.*
- **M5 · Zoom rooms** — Zoom API auto-creates a recurring meeting per cohort; join links surfaced **only to confirmed enrollees**. *Deps: M4, M2.*
- **M6 · Attendance** — per-session marking (manual in v1; Zoom attendance-report sync as a later enhancement). *Deps: M4, M2.*
- **M7 · Notifications (WhatsApp)** — WA provider integration + Celery reminder jobs + templates (enrollment confirmation, session reminder, payment-pending nudge). *Deps: M2, M4.*
- **M8 · Materials** — per-cohort files / links / recordings + optional **kitab-passage links**; access-gated to enrollees. *Deps: M2.*
- **M9 · Certificates** — PDF generated on completion criteria; issuance + public verify link. *Deps: M6.*
- **M10 · Ustadz & Admin console** — tutor profiles; **honorarium tracking** (sessions taught → payout calc); roster / attendance / payment-verify admin panel. *Deps: M2, M3, M6.*
- **M11 · Student dashboard ("Kelas Saya")** — schedule, join links, materials, certificate. *Deps: M2, M4, M5, M8.*

---

## 5. Payment approach (decision #10, #15, #17)

Indonesian-market fit: students pay by **bank transfer to a Virtual Account** — they transfer to a unique number and the payment is **auto-confirmed via webhook**, no manual checking.

- **Mechanism:** aggregator-issued Virtual Account (Midtrans recommended; Xendit fallback). Live in days; small per-transaction fee; still "transfer to a number" from the student's point of view. Also unlocks QRIS / e-wallet with the same integration if wanted later.
- **Why not direct bank statement / open-banking APIs:** they are painful for per-order matching and usually require a corporate agreement — VA is the purpose-built tool.
- **Why aggregator over direct bank VA (PKS) for launch:** a direct bank VA agreement is cheapest per-transaction but needs volume commitments and weeks of paperwork; the aggregator avoids that lead time. Migrate to a direct bank VA later if volume justifies.
- **Manual transfer + proof-upload** is retained only as an optional fallback for banks the aggregator VA doesn't cover.
- **Constraint:** payment flow must be **riba-free** — one-time fee only, no interest, no interest-bearing installments.

---

## 6. MVP scope & build order

**Milestone = Full-v1 (decision #16):** all of M1–M11 complete before the first cohort opens.

Recommended build sequence (dependency-driven; each lands behind its own feature flag):

1. **Spine:** M1 (Catalog) → M2 (Enrollment) → M3 (VA Payments) → M4 (Scheduling)
2. **Live delivery:** M5 (Zoom) → M11 (Student dashboard) → M7 (WhatsApp reminders)
3. **Operations:** M6 (Attendance) → M8 (Materials) → M10 (Ustadz & Admin console)
4. **Completion:** M9 (Certificates)

Launch gate = the first real cohort can be discovered, paid for (VA auto-confirm), attended on Zoom with WhatsApp reminders, tracked for attendance, given materials, and issued a certificate on completion — all without manual payment reconciliation.

---

## 7. Evaluation criteria (how the final product is judged)

**Correctness & money integrity**
- Seat cap is **never** exceeded under concurrent enrollment (hard invariant).
- **No student receives a join link or materials without a confirmed (paid) enrollment**; every confirmed payment grants access within one reminder cycle.
- Zero double-charge / double-enroll; every order reconciles to exactly one enrollment.
- Every payment event has an audit trail (webhook payload retained; manual verifications logged with actor + timestamp).

**Sharia compliance** (PRD §12)
- Payment flow **riba-free** (one-time fee; no interest / interest-bearing installments).
- **Gender restriction enforced** at enrollment (an akhwat cohort cannot admit ikhwan, and vice-versa).
- Any kitab reference in materials is **retrieved from Qdrant, never invented**; any AI-assisted copy is labelled.

**Data protection** (UU PDP §27/2022)
- Student PII + payment records resident **in Indonesia**; consent captured at signup; deletion path exists.
- Documented stance on Zoom (US-hosted) roster/recording handling.

**Conversion & UX**
- Registration → payment → access funnel completion rate is the **primary product metric**.
- Mobile-first (Indonesian users are mobile-dominant); join link reachable in ≤2 taps from "Kelas Saya".

**Operations**
- WhatsApp reminder **delivery rate** and pre-session attendance lift.
- Attendance captured for ≥95% of sessions; certificate issued **only** when completion criteria met.
- Admin effort per cohort minimized (VA auto-sync should drive manual reconciliation to ~zero).

**Cost / self-funding**
- Per-cohort tool cost (Zoom plan + WA messages + VA fees) tracked via the `usage_events` pattern and **< the cohort's margin**. No spend charged to the intelligence-product IDR 1.5–2M cap.

**Architecture health**
- Zero coupling from the class module into the briefing/ingest pipeline; every module feature-flaggable and independently deployable.

---

## 8. Risks & constraints

- **Signup approval friction:** the current `pending → admin approves` gate must be **bypassed for paying students** (decision #14) or every enrollment bottlenecks on a human.
- **Zoom data residency vs UU PDP:** video/recordings on Zoom (US). Requires a documented consent + storage stance.
- **Zoom account tier:** API meeting-creation + cloud recording needs a **paid Zoom plan** per concurrent host — a fixed monthly cost the self-funding P&L must carry.
- **WhatsApp provider trade-off:** unofficial (Fonnte / Wablas — cheap, ToS risk) vs official WhatsApp Business API (pricier, stable).
- **Resend free tier** = 3K emails/month — adequate early; monitor at scale.
- **VA aggregator fees** eat into margin on low-priced courses — price courses with the per-transaction fee in mind.

---

## 9. Non-engineering critical path (procurement / business — start now, they have lead time)

1. **VA aggregator** — open Midtrans (or Xendit) account; obtain sandbox + production credentials; confirm VA product + fee schedule. *(Start first.)*
2. **Zoom** — paid plan + API app (Server-to-Server OAuth) credentials; decide host allocation for concurrent classes.
3. **WhatsApp** — choose provider (Fonnte/Wablas vs official WABA); register sender number + templates.
4. **Finance** — settlement account; **refund / cancellation policy** (must exist before selling); riba-free confirmation.
5. **Business inputs** — course catalog + syllabi; per-course pricing (net of VA fee); ustadz honorarium rates; certificate completion criteria (e.g. attendance threshold).

---

## 10. Next steps

- [ ] Confirm procurement owners + timelines for §9 (VA aggregator is the long pole).
- [ ] Produce per-module spec sheets (M1–M11): data model, endpoints, state machines, acceptance tests — still design-only.
- [ ] Finalize WhatsApp provider (Fonnte/Wablas vs WABA) and Zoom host allocation.
- [ ] Draft refund/cancellation + data-protection (UU PDP) policy copy.
- [ ] Greenlight to begin implementation (separate approval — no code until then).
