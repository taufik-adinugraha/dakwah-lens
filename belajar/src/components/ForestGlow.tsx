/**
 * The main site's forest glow (web/src/app/[locale]/login/page.tsx), behind
 * the hub, the Qur'an track and its lesson pages (operator, 2026-10-10:
 * "more colourful … like the home page"). Decorative: aria-hidden, no
 * pointer events. Render it as the first child of a `relative isolate`
 * wrapper; the gradient itself is `.forest-glow` in globals.css, so a
 * browser that asks for dark gets it toned down.
 *
 * The layer reaches down through the footer's top margin (layout.tsx:
 * `mt-16`), so the glow ends on the footer's border line, not in mid-air;
 * at the top it starts on the header's border. The wrapper must not clip
 * with `overflow: hidden`: that would make it the scroll container of the
 * lesson's sticky controls bar. The gradient never paints outside this
 * layer, so nothing needs clipping.
 */
export function ForestGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -bottom-16 -z-10 overflow-hidden">
      <div className="forest-glow absolute inset-0" />
    </div>
  );
}
