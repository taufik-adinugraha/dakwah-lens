/**
 * Renders a JSON-LD structured-data block. Google reads
 * `<script type="application/ld+json">` from the SSR HTML. `data` may be a
 * single schema object or an array of them. Allowed under our CSP because
 * `script-src` includes 'unsafe-inline' (and ld+json is inert data, not
 * executed script).
 */
export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
}) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify escapes </script> sequences as needed; content is
      // built from our own DB, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
