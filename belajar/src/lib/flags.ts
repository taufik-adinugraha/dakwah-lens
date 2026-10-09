/**
 * BELAJAR_PUBLIC — false until the first ustadz-approved lesson ships (plan
 * §7.6). While false, every page is `noindex` (still crawlable: never block in
 * robots.txt, or Google can't see the noindex). Read at BUILD time — the
 * lesson pages are statically prerendered — so flipping it is a deploy, which
 * is what a public launch is anyway.
 */
export const IS_PUBLIC = process.env.BELAJAR_PUBLIC === "true";
