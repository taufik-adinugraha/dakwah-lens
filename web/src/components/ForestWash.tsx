/**
 * The site's signature green backdrop — the exact two-tone radial wash
 * from the landing hero (deep forest breathing down from the top, a
 * fainter answer in the lower-right), extracted so every public page
 * can carry the same light. Tune the alphas HERE and the whole site
 * follows.
 *
 * Usage: place as the first child of a `relative` (ideally `isolate
 * overflow-hidden`) container:
 *
 *   <section className="relative isolate overflow-hidden bg-paper">
 *     <ForestWash />
 *     …
 */
export function ForestWash() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90rem 42rem at 50% -12rem, rgba(14, 90, 60, 0.42), transparent 68%)," +
            "radial-gradient(64rem 36rem at 88% 108%, rgba(14, 90, 60, 0.26), transparent 68%)",
        }}
      />
    </div>
  );
}
