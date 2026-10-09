/**
 * BELAJAR_PUBLIC — false until the operator decides the module may be indexed
 * (plan §7.6; there is no human review step since 2026-10-09, so the
 * draft-refusing public build in lib/content.ts must be revisited first). While false, every page is `noindex` (still crawlable: never block in
 * robots.txt, or Google can't see the noindex). Read at BUILD time — the
 * lesson pages are statically prerendered — so flipping it is a deploy, which
 * is what a public launch is anyway.
 */
export const IS_PUBLIC = process.env.BELAJAR_PUBLIC === "true";
