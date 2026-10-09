# architecture

## SUMMARY
- **Placement:** I recommend a path, `https://dakwah-lens.id/belajar/…`, served by its own Next.js container behind the existing host Caddy, not a subdomain. The session cookie is host-only (`__Secure-authjs.session-token`, path=/, no Domain), and login only accepts relative callback URLs. So a path gives sign-in with zero changes to the main app's auth. A subdomain would need changes in `auth.ts`, the login actions and the cookie scope for every user.
- **Stack:** a new `belajar/` package in the monorepo. It uses the same pins as `web/` (Next 16, React 19, Tailwind v4, next-intl) with `basePath: "/belajar"` and `output: "standalone"`, and needs no Chromium. Lessons are prerendered from reviewed JSON content, following the existing `/doa` precedent. At runtime there are no LLM calls and no Qdrant calls. The only dynamic parts are learner progress and the reviewer draft preview. A static export is ruled out because it drops cookies, route handlers, proxy and draft mode, and FastAPI is not public.
- **Progress data:** a new database `dakwah_belajar` inside the existing Postgres container, with its own role and Drizzle migrations. It must not go in the main DB: alembic autogenerate there has no `include_object` filter and would propose dropping foreign tables. Anonymous learners use localStorage and merge into the server on login. Spaced repetition uses ts-fsrs (MIT).
- **Deploy isolation hazards found in the repo:** (1) the main compose project `dakwah-lens` runs `up -d --remove-orphans`, so the module must use its own compose project name or the main deploy deletes its containers; (2) every push to main runs the main deploy and shows a user-facing "update in progress" overlay, so `deploy.yml` needs `paths-ignore` for the module; (3) GitHub concurrency groups shared across workflows cancel *pending* runs, so the module needs its own group, plus a VM-level `flock` to serialise Docker builds.
- **Content pipeline:** retrieval runs inside the prod api image against prod Qdrant (read-only, via the existing keyed lookups) and writes a frozen provenance snapshot (point id + sha256). Everything after that (assembly, morphology from the Quranic Arabic Corpus, concordance counts, the basmalah 27:30 parallel, quiz bank, CI checks) runs offline from the snapshot. Publishing requires an ustadz sign-off record tied to the content hash.
- **The TTS code no longer exists:** there is no ElevenLabs code in the repo, and every `/tmp` reference script named in memory (e.g. `render_kesehatan_haidir_v4.py`, `render_cit_noparens.py`, `/tmp/piper-poc/qari-mix/`) is gone (checked). The Allah→Alloh, wasl, number-to-words and citation preprocessors must be rebuilt in the repo with tests before any render. Qur'anic words inside narration must be cut from the qari recording, never synthesised.
- **Data-quality and licensing flags:** the existing `quran.json` has a BOM on 1:1 and an OCR defect ("SuIaiman") in the 27:30 Indonesian text. The Indonesian translation is labelled "Kemenag" in AGENTS.md but `download_quran.py` says it is not Kemenag, and AlQuran.cloud lists its translator as "Unknown". The Ibn Kathir English text is the abridged Mubarakpuri edition, whose public republication rights are UNVERIFIED. Recitation audio and word-timestamp licensing is UNVERIFIED (QUL issue #796 has no maintainer answer).
- **Cost:** runtime cost is roughly one extra Node process. The new spend is ElevenLabs narration, which should get its own budget line. My rough estimate of a Creator plan at $22/month for 275k characters is about IDR 360k, or about 18–24% of the existing IDR 1.5–2M cap if charged against it. This is flagged per the cost rule.
- **VPS size:** the only size clue in the repo is a legacy comment, "shared 4-vCPU VM". RAM and disk are UNVERIFIED; they can be read from the `system_metrics` table.

## RECOMMENDATIONS
- **Lock the placement:** a path under the main domain, `dakwah-lens.id/belajar/{id|en}/…`, served by a new `belajar/` Next.js 16 standalone app with `basePath: "/belajar"`. Keep it in the monorepo but outside `web/` and `api/`, so module commits never rebuild the main stack. The slug (`belajar` / `quran` / `ngaji`) is the operator's call.
- **Edge routing:** route at Caddy, not via Next rewrites in the main app, so the module stays up when `web` is down. Use three `handle` blocks (media file_server, `/belajar*` to :3200, fallback to :3000), with `deploy.sh` as the only owner of the Caddyfile.
- **Isolate the deploy:**
  - Compose project `name: dakwah-belajar` with the external network `dakwah-lens_dakwah`.
  - A separate `deploy-belajar.yml` with `paths:` filters and its own concurrency group.
  - `paths-ignore` on `deploy.yml`.
  - A VM-level `flock` shared by both deploy scripts.
  - A `mem_limit` on the module container.
- **Make content static and reviewed:** lessons are JSON in `belajar/content/` (never a dir named `data/`), prerendered with SSG. No LLM or Qdrant calls at runtime. Progress, exam scoring and the reviewer Draft Mode preview are the only server paths.
- **Progress storage:** a new database `dakwah_belajar` and role in the existing Postgres container, migrated by the module's own Drizzle. Anonymous localStorage first, merged on login. FSRS via ts-fsrs.
- **Identity:** spike Option A (server-side session introspection against `web:3000/api/auth/session`) before settling on it. Fall back to a shared-secret `getToken` only if the spike fails. Never copy `api/services/auth.py`'s HS256 decode.
- **Two-phase pipeline:** the retrieval snapshot is produced inside the prod api image against prod Qdrant (read-only, with point ids and sha256). Assembly, concordance, parallels, quiz generation and all CI checks run offline from it. Publishing is blocked unless a committed ustadz sign-off matches the content hash.
- **Before any ElevenLabs spend:**
  - Rebuild the lost preprocessors (Allah→Alloh, wasl, numbers to words, citation expansion with no parentheses) in `belajar/pipeline/tts/` with unit tests.
  - Fix the stale memory body (v2 / "on" / `previous_text`).
  - Test `with-timestamps` on `eleven_v3` with one paid call, after explicit approval.
- **Never synthesise Qur'anic text,** including single words inside narration. Splice qari word clips using verified word timestamps, and have a human check the timestamps for every Al-Fatihah word.
- **Main-app link-backs:**
  - Header and mobile nav, plus a raw-`<a>` Footer variant.
  - `Nav.belajar` in both message files.
  - A "Pelajari kata per kata" link in the `Article.tsx:193` strong renderer, on Qur'an hits in `kitab/page.tsx`, and in DaleelChips. All go through a module resolver URL with a surah-1 allowlist.
  - `robots.ts` sitemap array, the privacy page, and a signed user-deletion hook.
- **Gate the nav link** with an `app_settings` key (existing pattern), and keep module pages noindex (crawlable, not robots-blocked) until the first ustadz-approved lesson ships.
- **Budget:** open a separate line for ElevenLabs and any recitation licence, like the Kelas self-funding P&L. Record actual spend under the existing `elevenlabs` provider in `manual_costs`.

## RISKS
- **Cost cap (flagged per AGENTS cost rule):** ElevenLabs narration is new recurring spend. My rough estimate: Creator plan $22/month for 275k characters is about IDR 360k at the app default of 16,300 IDR/USD, which is about 18–24% of the IDR 1.5–2M cap if charged against it. Review re-renders multiply the cost. The operator must decide: a separate budget line, or no.
- **Indonesian translation licence and attribution:** AGENTS.md:24 and README:36 say "Kemenag", but `download_quran.py:5,8-10` says the edition is `id.indonesian` and not Kemenag. AlQuran.cloud lists its translator as "Unknown", and its terms require naming the translator when republishing. A public learning module needs a properly attributed and licensed ID translation. UNVERIFIED which one is permissible.
- **Tafsir rights:** the Ibn Kathir English text in Qdrant is the abridged Mubarakpuri (Darussalam) edition via spa5k/tafsir_api. The repo is MIT, but the text copyright is not addressed. Public republication rights are UNVERIFIED. al-Tabari Arabic is described as public domain in `download_tafsir_tabari.py:1` (the repo's own claim).
- **Recitation audio and word timestamps:** licences for hosting, streaming and commercial use are UNVERIFIED. QUL issue #796 is unanswered and also reports an Al-Fatihah word-ID ordering oddity in `segments.json`. Self-host only after written permission. Hotlinking a foreign CDN would also leak learner IPs (UU PDP) and needs CSP changes.
- **QAC licence:** GPL v3 plus "changing not allowed" terms. Do lesson JSON files derived from it count as GPL derivatives, and how should known QAC errors be corrected (an overlay versus editing the file)? This needs an operator or legal decision.
- **Corpus data defects:** 1:1 has a leading U+FEFF and 27:30 ID reads "SuIaiman". Tanzil forbids modifying its text. Decide whether lessons take Arabic from a fresh Tanzil download (verbatim, checksummed) instead of `quran.json`.
- **Lost TTS code:** every `/tmp` reference implementation cited in memory is gone. Until the preprocessors are rebuilt and tested, any render risks the 2026-06-14 failure modes (dropped citations, Allah pronunciation, wasl).
- **v3 behaviour unverified:** whether `with-timestamps` works on `eleven_v3`, and whether `language_code` is accepted on v3, needs one paid test call (requires explicit permission).
- **VPS capacity UNVERIFIED:** only "4-vCPU" is known, from a legacy comment. Before committing, check RAM and disk headroom with `SELECT mem_total_mb, mem_used_mb, disk_total_gb, disk_used_gb FROM system_metrics ORDER BY captured_at DESC LIMIT 1;`. A second Next build on the VM competes with prod CPU.
- **Sign-in spike needed:** server-side introspection must present the `__Secure-` cookie over internal HTTP (`X-Forwarded-Proto`). If it fails, the fallback of sharing `NEXTAUTH_SECRET` widens the blast radius (forgeable superadmin sessions).
- **Same-origin trade-off:** path placement means module XSS could call main-app endpoints with user cookies. This is acceptable only while the module carries no user-generated HTML; revisit if comments or forums are added.
- **Grammar coverage UNVERIFIED:** whether the QAC syntactic treebank covers all of Al-Fatihah is not confirmed. The "why fathah/dammah" explanations otherwise need ustadz-authored i'rab sourced from a grammar kitab (content track).
- **Operator decisions:**
  - The slug (`/belajar` vs `/quran`) and the locale URL shape (`always` vs `as-needed`).
  - Which narration voice(s), and whether named ustadz voices may be used for teaching content.
  - Who the ustadz reviewers are and how sign-off is recorded.
  - Whether pending (unapproved) users may save progress.
  - Whether to build images in CI or on the VM.
- **Rule reminders:** every render, every prod DB creation (`CREATE DATABASE dakwah_belajar`), every Caddy change and every commit requires explicit operator approval (ALWAYS ASK PERMISSION / ASK BEFORE COMMIT). No step of this plan has been executed.

## REPORT
# Architecture track: Qur'an learning module in its own container

All paths below are relative to `/Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens`. No repo files were edited.

## 1. What the repo shows today

| Area | Finding | Source |
|---|---|---|
| Edge proxy | Host **Caddy**. One site block (`dakwah-lens.id, www`) sends everything to `localhost:3000`. FastAPI is reachable only inside the Docker network. | `deploy/Caddyfile:16-31` (comment at 19-22) |
| Caddy ownership | `deploy.sh` installs the Caddyfile through a sudoers-whitelisted `install` and reloads Caddy. `nginx.conf` and `deploy/systemd/*` are legacy: deploy.sh never references them. | `deploy/deploy.sh:48-53, 82-93` |
| Compose | Project is `name: dakwah-lens`, network is `dakwah`. App ports are bound to 127.0.0.1. One Postgres instance with a bind mount at `/srv/dakwah-lens/data/postgres`. | `docker-compose.prod.yml:20-24, 28-45, 135-139` |
| Deploy | Any push to main runs verify, then SSH, then `deploy.sh`. A user-facing overlay POST fires at the start. The script builds the explicit service list `web api worker beat`, then runs `up -d --remove-orphans web api worker beat`. | `.github/workflows/deploy.yml:6-9, 100-113, 115-129`; `deploy.sh:124, 185` |
| Base-image refresh | Runs `up -d --remove-orphans` on all services. | `deploy/refresh-base-images.sh:38, 49` |
| Concurrency | `deploy-prod` group, already shared with the rollback workflow. | `deploy.yml:15-17`; `rollback.yml:23-25` |
| How the web app gets data | Drizzle talks to Postgres directly. Qdrant is called directly. Only the PDF route calls FastAPI. | `web/src/db/index.ts:6-16`; `web/src/lib/kitab-retrieval.ts:1-25`; `web/src/app/api/briefings/[id]/pdf/route.ts:30-36` |
| Auth | Auth.js v5 beta.31 with JWT strategy. Cookie: httpOnly, lax, path=/, **no Domain**. The token is a **JWE (A256CBC-HS512)** keyed by HKDF with salt = cookie name. Max age 30 days. | `web/src/auth.ts:51`; `node_modules/@auth/core/lib/utils/cookie.js:44-55`; `@auth/core/jwt.js:8,44,47,86,110-122` |
| Redirects after login | The default Auth.js callback accepts only same-origin URLs. The login actions accept only relative `callbackUrl`. | `@auth/core/lib/init.js:13-19`; `web/src/app/[locale]/login/actions.ts:58-63, 450-452` |
| FastAPI auth | Decodes the token as an **HS256 JWS**, which is incompatible with Auth.js v5's JWE. No web code sends bearer tokens to it (checked by grep). Do not copy this pattern. | `api/src/api/services/auth.py:49-62` |
| Kitab retrieval | Keyed lookups already exist: `retrieve_quran_ayah`, `retrieve_tafsir_for_ayah` (Ibn Kathir EN + al-Tabari AR), and `retrieve_by_citation` (accepts "Sahih al-Bukhari N" and "QS. X: N"). There is an ID tafsir cache table `tafsir_translations_id`. | `api/src/api/services/kitab_retrieval.py:289-317, 1009, 1273, 1367`; `api/alembic/versions/20260710_1200_tafsir_id_translations.py` |
| Qur'an data | 6,236 ayat with only `arabic/id/en`: no word segmentation and no morphology. 1:1 starts with U+FEFF. The 27:30 ID text has "SuIaiman". | `api/data/quran.json` (inspected) |
| Indonesian translation provenance | AGENTS.md and README say "Kemenag". `download_quran.py` says `id.indonesian`, "isn't on AlQuran.cloud… swap to Kemenag". The AlQuran.cloud API lists the `id.indonesian` translator as "Unknown". | `AGENTS.md:24`; `README.md:36`; `api/src/api/scripts/download_quran.py:5, 8-10`; api.alquran.cloud/v1/edition?language=id |
| TTS | No ElevenLabs code is in the repo. The only hits are `cost-providers.ts:11,32` and AGENTS.md. The memory reference scripts in `/tmp` were checked and are **missing**. | grep and `ls` of `/tmp` |
| Design language | Paper/ink/forest tokens and `font-display`/`font-body` theme tokens. Amiri, Fraunces and Inter loaded via next/font. | `web/src/app/globals.css:30-44`; `web/src/app/[locale]/layout.tsx:32-55` |
| VPS size | Only "shared 4-vCPU VM", in a legacy unit file. RAM and disk are UNVERIFIED. The `system_metrics` table (`mem_total_mb`, `disk_total_gb`) is written every minute. | `deploy/systemd/dakwah-celery-worker@.service:14-16`; `web/src/db/schema.ts:446-461`; `api/src/api/services/metrics.py` |
| Precedent for content-as-data | `/doa` pages import a build-time JSON copy and are fully static. A parity script guards the two copies. The `.gitignore` `data/` rule once silently dropped files. | `web/src/lib/doa.ts:1-21`; `web/scripts/check-doa-parity.mjs`; `.gitignore:34-38` |

## 2. Placement: path or subdomain

| Criterion | Path `dakwah-lens.id/belajar/…` (recommended) | Subdomain `belajar.dakwah-lens.id` |
|---|---|---|
| SSO | The cookie (path=/, host-only) already reaches the module. Login link `/id/login?callbackUrl=/belajar/…` passes the existing guards. **Zero auth changes.** | Needs `cookies.sessionToken.options.domain` (Auth.js calls this an "advanced option… may have complex implications"). Old host-only and new domain cookies with the same name would coexist. Also needs a custom `redirect` callback and changes to `safeCallbackUrl`. |
| SEO | Same host, sitemap and Search Console property. Fits the evergreen-lookup thesis in `docs/doa-pages-plan.md:8-27`. Google lists "Low maintenance (same host)" as a pro for subdirectories. | Google lists "Easy separation of sites" as the pro. Needs a separate sitemap and Search Console property. |
| CSP | Same origin: `connect-src`/`media-src 'self'` just work. The main CSP is at `web/next.config.ts:17-31`. | Cross-origin audio and fetches need CSP and CORS edits. |
| Security | Shared origin: XSS in the module could make credentialed requests to the main app. The module has no user-generated HTML, so this risk is low. | Origin isolation. |
| Deploy | One Caddy `handle` block. The module app owns everything under `/belajar*`. | DNS record plus a new site block. HSTS `includeSubDomains` is already set (`Caddyfile:26`). |

**Navigation rule:** use plain `<a>` for links across apps. Next's multi-zones guide says `<Link>` "will try to prefetch and soft navigate… which will not work across zones" (`web/node_modules/next/dist/docs/01-app/02-guides/multi-zones.md:114-116`).

**Caddy sketch:** for `handle` directives, Caddy sorts the more specific path first, so the media block wins over `/belajar*`:

```
handle /belajar/media/* { uri strip_prefix /belajar/media
  root * /srv/dakwah-lens/data/belajar-media; file_server }
handle /belajar* { reverse_proxy localhost:3200 }
handle { reverse_proxy localhost:3000 }
```

Caddy's `file_server` returns 206 for range requests, which audio seeking needs. Only `deploy.sh` should ever touch the Caddyfile.

## 3. App stack

- **`belajar/` Next.js app (recommended).** Its own `package.json`, its own Dockerfile (node:22-alpine runner, no Chromium; the web image installs Chromium only for flyers, `web/Dockerfile:56-73`), `basePath: "/belajar"`, `output: "standalone"`. Use next-intl with `localePrefix: "always"` to mirror `web/src/i18n/routing.ts:6`, giving `/belajar/id/al-fatihah/2`.
- **Lessons** are SSG pages built with `generateStaticParams` over `belajar/content/**`. Do not name the folder `data/` because of `.gitignore:34`.
- **Server features kept:** route handlers for progress and quiz-exam scoring, and Draft Mode for reviewer preview.
- **Why not static export:** it drops cookies, Request-based route handlers, proxy and draft mode (`…/static-exports.md:274-292`), and FastAPI is not public. A progress API would therefore need a new public service anyway.
- **Media** (qari clips, narration MP3s) is not in git and not in the image. It lives in a host directory with content-addressed filenames and is served by Caddy.
- **Progress storage:** a new database `dakwah_belajar` in the existing Postgres container, with a dedicated role that has no grants on `dakwah_lens`. The init script only runs on a fresh volume (`deploy/postgres-init.sql`), so create the database once by hand. Reasons not to use the main DB: alembic autogenerate compares against `Base.metadata` with no `include_object` (`api/alembic/env.py`), and the credentials would be shared.
- **Tables:** `learners(user_id uuid PK, no FK)`, `lesson_progress`, `quiz_attempts`, `srs_cards` (FSRS state), `srs_reviews`.
- **Anonymous use is first-class.** localStorage uses the same shapes and is unioned server-side on login. Pending users (`users.status` default pending, `schema.ts:27-45`) can still learn, mirroring the Kelas approval-bypass idea (`docs/kelas-plan.md:35`).

## 4. Sign-in and identity

- **Option A, session introspection (recommended).** The module's server calls `http://web:3000/api/auth/session` over the shared Docker network, forwarding the user's cookie. `NEXTAUTH_SECRET` then stays in one service only. A spike is needed: Auth.js picks the `__Secure-` cookie name from the protocol, so send `X-Forwarded-Proto: https`.
- **Option B, shared secret.** Decode the cookie with `getToken` from `@auth/core/jwt` using the same secret. This is simpler, but a compromised module could then forge superadmin sessions.
- **Either way:**
  - The module is a read-only consumer and never re-issues the cookie.
  - Role and status claims can lag, because only the main app refreshes them (`auth.ts:163-183`).
  - A learner who uses only the module for 30 days hits token expiry and must sign in again.
- **UU PDP:**
  - Store only `user_id`; the database stays on the same Jakarta VPS.
  - Disclose the new data on `/privacy`.
  - Add a deletion hook: the admin hard-delete (`web/src/app/[locale]/admin/actions.ts:175-230`) cascades only within the main DB. It should POST an HMAC-signed `user-deleted` event, following the `deploy.yml:109` pattern, backed by a nightly cleanup of orphaned rows.

## 5. Content pipeline

| Stage | Where | What |
|---|---|---|
| 0. Source registry | `belajar/pipeline/sources.yaml` | URL, version, sha256, licence and attribution text for each input. Keep the QAC morphology file verbatim in `belajar/vendor/`; its terms say "CHANGING IT IS NOT ALLOWED" and require a link to corpus.quran.com. |
| 1. Retrieve (prod) | `docker compose run --rm -v …/belajar/pipeline:/p:ro -v …:/out api python /p/retrieve.py` | Uses `retrieve_quran_ayah`, `retrieve_tafsir_for_ayah` and `retrieve_by_citation` (e.g. Bukhari/Muslim fadhilah hadith) against prod Qdrant, read-only. Writes `snapshots/*.json` with collection, point id, chunk index, text and sha256. This honours the "retrieved from Qdrant" hard rule and memory's "corpus is not the pool" lesson. |
| 2. Assemble (offline) | `belajar/pipeline` (uv project; path dependency on `api` only if needed) | Word segmentation, root, lemma, case and mood from QAC. Concordance counts and occurrence lists, computed deterministically. Exact and normalised n-gram parallels (basmalah 1:1 ↔ 27:30). Quiz item bank built from word data. **No LLM in any counted or located fact.** |
| 3. Author | Claude in chat or ustadz (per the no-Gemini-for-manual rule) | Simple i'rab and morphology explanations, and narration scripts. Every Arabic string or claim is a `{ref}` to a snapshot entry. Reuse the folded-match idea from `api/src/api/scripts/verify_briefing_arabic.py`. |
| 4. Render (asks permission; costs money) | `belajar/pipeline/tts/` | Rebuild the lost preprocessors (Allah→Alloh, wasl, `_num_id`, citation expansion with no parentheses) with unit tests. Call ElevenLabs `/v1/text-to-speech/{voice}/with-timestamps` for character alignment and highlighting, with `eleven_v3` and the house settings, `apply_text_normalization: "off"`. Cache by hash of (text + voice + model + settings) so unchanged segments are never re-rendered. Qur'anic words come from the qari's word segments (QUL `[word, start_ms, end_ms]`), never from TTS. |
| 5. Review gate | Draft Mode preview, then `belajar/content/reviews/<lesson>.json` | Records reviewer, date, `content_sha256` and `audio_manifest_sha256`. CI fails if any lesson's hash has no matching sign-off. Merging the PR is the publish step. |
| 6. Validate (CI) | `deploy-belajar.yml` | JSON schema checks. Ref bytes match the snapshot. Qur'an text bytes match the Tanzil source. Any segment with `is_quranic` must have `audio.kind=recitation`. The "AI-assisted, bukan fatwa otoritatif" label is present. |
| 7. Publish | Module deploy | Bake content into the image. Rsync media into `/srv/dakwah-lens/data/belajar-media` with immutable names. |

**Stale memory caveat:** the body of `feedback_voice_render_settings.md` still shows `eleven_multilingual_v2`, `"on"` and `previous_text`. Code must follow the header standard: v3, `off`, and no previous/next text, since the operator saw HTTP 400 on v3. ElevenLabs docs say `language_code` "is not supported for multilingual_v2". Whether `with-timestamps` works on v3 needs one paid test call.

## 6. Deploy, CI and operations (no coupling)

- **New files:**
  - `belajar/Dockerfile`
  - `deploy/belajar/docker-compose.yml`: `name: dakwah-belajar` (avoids the `--remove-orphans` deletions at `deploy.sh:185` and `refresh-base-images.sh:49`); service `belajar-web` bound to `127.0.0.1:3200:3000`; external network `dakwah-lens_dakwah` (check with `docker network ls`); a `mem_limit` and `NODE_OPTIONS=--max-old-space-size`, with values to be measured.
  - `deploy/belajar/deploy.sh`: git sync, then `flock /srv/dakwah-lens/.deploy.lock`, build, drizzle migrate, `up -d`, then a health probe on `/belajar/api/health` like `deploy.sh:195-205`. No Caddy edits and no overlay.
  - `.github/workflows/deploy-belajar.yml`: `paths: [belajar/**, deploy/belajar/**]` and its own concurrency group. GitHub docs: shared group names "cancel… pending job… regardless of the workflow".
- **Edit `deploy.yml`:** add `paths-ignore` for the same paths. "When all the path names match patterns in paths-ignore, the workflow will not run", so module-only commits will not lock every user's tab with the overlay.
- **Add the same `flock`** to `deploy.sh` so two Docker builds never run at once on a 4-vCPU box.
- **Footprint:** one Node process plus a few tens of MB of Al-Fatihah media. A full-Qur'an reciter archive would be much larger; check disk first. If VM build CPU hurts prod, build in Actions and `docker save | ssh docker load`.
- **Feature flags:**
  - Module env `BELAJAR_PUBLIC`: noindex until launch, following the allow-crawl-plus-page-noindex rule in `robots.ts:23-29`.
  - Main-app nav via an `app_settings` key, using the pattern in `web/src/lib/settings.ts:16-44`. Header is a request-time server component (`Header.tsx:11-16`), so it toggles without a redeploy.

## 7. Files that would change in the main app

| File | Change |
|---|---|
| `deploy/Caddyfile` | The three `handle` blocks above. |
| `.github/workflows/deploy.yml`, `deploy/deploy.sh` | `paths-ignore`; `flock`; optionally `fix_volume_dir …/belajar-media` (Caddy's user needs read access). |
| `web/src/components/Header.tsx:25-38, 96-118` | A nav item as plain `<a href="/belajar/{locale}">`, not next-intl `Link`. |
| `web/src/components/Footer.tsx:107-115` | `FooterLink` uses next-intl `Link`, so add a raw `<a>` variant. |
| `web/messages/{id,en}.json` (`Nav`, line 17ff) | `belajar` label in both files (`web/AGENTS.md:21`). |
| `web/src/app/[locale]/m/[id]/Article.tsx:193` | Bold `QS. Al-Faatiha: n` gets a "Pelajari kata per kata →" link. This renderer serves the khutbah, kultum and other deliverable pages. |
| `web/src/app/[locale]/kitab/page.tsx:776-795` | A chip next to Bookmark/Share for Qur'an hits that have a lesson. |
| `web/src/components/DaleelChips.tsx`; `khutbah-kultum/page.tsx` | The same link in the daleel modal and cards. |
| `web/src/app/robots.ts:36` | `sitemap` becomes an array including `/belajar/sitemap.xml`. |
| `web/src/app/[locale]/admin/actions.ts:175-230` | Signed `user-deleted` call to the module. |
| `privacy`, `how-it-works`, `transparency` pages and messages | Disclose the new data and sources; record ElevenLabs under its own cost line (provider already exists, `cost-providers.ts:11,32`). |

**Avoiding drift:** link through a module resolver (`/belajar/r?c=<citation>`) plus a tiny allowlist in web (surah 1 only at first). This avoids copying a manifest, which would be another two-copies drift risk (`lib/doa.ts:12-16` notes it has shipped twice).

**Design tokens:** copy `globals.css:30-44` and the next/font setup into the module, with a parity script in the style of `check-doa-parity.mjs`.

## 8. Comparison with the Kelas plan

Kelas chose to live **inside** `web/` (`docs/kelas-plan.md:24, 47-52`). It is transactional and tightly bound to users: payments, enrollment, the admin console and Celery reminders. It also said it "could be split into its own service later".

This module is the opposite case:
- read-mostly content with its own review-gated release cadence;
- heavy static media;
- no runtime dependency on the intelligence pipeline;
- only three seams to the main app: read-only identity, design tokens, and build-time kitab retrieval.

That justifies a separate container, while keeping the monorepo for code reuse. One Kelas lesson carries over (decision #13): give learning progress its own domain rather than reusing `users.profile` or `org_members`.

## SOURCES
- Repo: deploy/Caddyfile, deploy/deploy.sh, docker-compose.prod.yml, .github/workflows/deploy.yml + rollback.yml | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/deploy/Caddyfile | Internal (Sukses & Berkah Group) | Current edge proxy, deploy flow, compose project/network, remove-orphans and concurrency hazards
- Repo: web/src/auth.ts, web/src/proxy.ts, login/actions.ts, node_modules/@auth/core (cookie.js, jwt.js, init.js) | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/web/src/auth.ts | Internal; @auth/core is ISC-licensed (package) | SSO design: host-only JWE session cookie, relative-only callbackUrl, default redirect callback
- Repo: api/src/api/services/kitab_retrieval.py, api/data/quran.json, download_quran.py, download_tafsir*.py, download_hadith.py | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/api/src/api/services/kitab_retrieval.py | Internal code; the data's own terms are listed separately below | Reusable keyed retrieval for the build pipeline; existing corpus data defects and provenance
- Repo: docs/kelas-plan.md, docs/doa-pages-plan.md, web/src/lib/doa.ts | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/docs/kelas-plan.md | Internal | Comparison with in-monorepo Kelas; content-as-data and SEO precedent
- Next.js 16 bundled docs: multi-zones.md, basePath.md, static-exports.md | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/web/node_modules/next/dist/docs/01-app/02-guides/multi-zones.md | MIT (Next.js) | Cross-app links must be plain <a>; basePath; static export unsupported features
- Caddy docs: handle_path, directive sorting, file_server | https://caddyserver.com/docs/caddyfile/directives#sorting-algorithm | Apache-2.0 (Caddy) | Path routing order (more specific first), prefix stripping, range-request support for audio
- Docker Compose: up --remove-orphans; project name precedence | https://docs.docker.com/compose/how-tos/project-name/ | Docker docs (public documentation) | Why the module needs its own compose project name
- GitHub Actions workflow syntax: paths/paths-ignore, concurrency | https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions | GitHub docs (CC BY 4.0) | Decoupled module CI; cross-workflow concurrency cancellation hazard
- Auth.js reference: cookies option | https://authjs.dev/reference/core#cookies | Public documentation | Subdomain SSO requires an 'advanced option' cookie override
- Google Search Central: managing multi-regional sites (URL structure options) | https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites | CC BY 4.0 (Google docs) | Subdirectory vs subdomain pros and cons (stated cautiously; no ranking claim)
- ElevenLabs API: text-to-speech convert and convert-with-timestamps; models; API pricing | https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps | ElevenLabs commercial ToS; paid per character | apply_text_normalization off/on/auto; character alignment for word highlighting; v3 5,000-char limit with ID+AR support; per-plan character quotas
- Tanzil Quran text license | https://tanzil.net/docs/text_license | CC BY 3.0 with no-modification clause | Canonical Arabic text: CC BY 3.0, verbatim only, attribution + link required
- AlQuran.cloud terms + edition list | https://alquran.cloud/terms-and-conditions | Free API; text non-commercial free, commercial needs attribution; reciter copyrights retained | Source of the existing quran.json; translators must be attributed by name; id.indonesian translator listed as 'Unknown'
- Quranic Arabic Corpus download terms + license | https://corpus.quran.com/download/ | GNU GPL v3 plus 'verbatim only, changing not allowed', attribution and link to corpus.quran.com | Word morphology, roots, case for the i'rab lessons and concordance counts
- QUL (Tarteel) with-segments docs + licensing issue #796 | https://github.com/TarteelAI/quranic-universal-library/issues/796 | Repo MIT; per-recitation audio and segment licences UNVERIFIED | Word-level recitation timestamps (word, start_ms, end_ms); licensing unanswered; an Al-Fatihah word-order oddity was reported
- spa5k/tafsir_api | https://github.com/spa5k/tafsir_api | Repo MIT (code); tafsir text copyright not stated, so Ibn Kathir EN (Mubarakpuri abridged) public republication is UNVERIFIED | Upstream of the existing Ibn Kathir and al-Tabari data
- ts-fsrs | https://github.com/open-spaced-repetition/ts-fsrs | MIT | Spaced-repetition scheduling (browser + Node >=20)