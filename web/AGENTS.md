<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DakwahLens web — project rules

## Stack pins (do not change without discussion)
- Next.js 16 (App Router) · React 19 · Tailwind v4 · TypeScript
- **next-intl v4** for i18n — locales `id` (default) + `en`, all routes under `src/app/[locale]/`
- `src/proxy.ts` (NOT `middleware.ts`) — Next.js 16 renamed this file convention
- `params` is async in pages and layouts: `const { locale } = await params;`
- Use `PageProps<"/[locale]">` and `LayoutProps<"/[locale]">` (global helpers)
- Always call `setRequestLocale(locale)` at the top of server components before any `getTranslations` call

## i18n conventions
- Translation messages live in `messages/{id,en}.json`, grouped by namespace (e.g. `App`, `Nav`, `Landing`)
- Use `useTranslations("Namespace")` in client components, `getTranslations("Namespace")` in server
- For internal navigation use `Link`/`redirect`/`useRouter` from `@/i18n/navigation` (locale-aware) — NOT `next/link` directly
- Add new strings to BOTH `id.json` and `en.json` simultaneously. Indonesian is the primary; English mirrors it
- Da'wah-specific vocabulary (da'i, khutbah, daleel, kitab, manhaj, aqidah) is first-class — do not translate these to generic English equivalents

## Backend integration
- API base URL from env `API_BASE_URL` (default `http://localhost:8000`)
- Auth tokens are forwarded server-side from NextAuth session (do not expose to client)
- All data fetches in server components by default; use client components only for interactivity

