/* eslint-disable @next/next/no-img-element */
import { Trash2 } from "lucide-react";

import { requireSystemAccess } from "@/lib/superadmin";
import { getAllAssetsFresh } from "@/lib/flyer/images/registry";
import { Card, EmptyState, HelpCallout, PageHeader } from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";
import { deleteFlyerAssetAction } from "./actions";
import { UploadFlyerAssetForm } from "./UploadFlyerAssetForm";

/**
 * Admin page for the DB-backed flyer asset registry.
 *
 * Read-side accessible to BOTH admin + superadmin (requireSystemAccess).
 * Write actions (upload, delete) also gate via requireSystemAccess —
 * adding decorative assets is intentionally low-friction so the design
 * team can contribute without superadmin escalation.
 *
 * Seeded assets (those committed to web/public/flyer-assets/*) are
 * marked "Seeded" in the list and can still be deleted via the DB —
 * but the file on disk stays put because the seed migration would
 * re-insert them on a fresh DB. Upload-from-admin assets get their
 * underlying file deleted from disk on row removal.
 */
export default async function FlyerAssetsPage() {
  await requireSystemAccess();

  const assets = await getAllAssetsFresh();
  const byKind = {
    photo: assets.filter((a) => a.kind === "photo"),
    ornament: assets.filter((a) => a.kind === "ornament"),
    pattern: assets.filter((a) => a.kind === "pattern"),
  };

  return (
    <>
      <PageHeader
        title="Flyer assets"
        subtitle="DB-backed library of photos, ornaments, and patterns used by the briefing flyer renderer. Upload to add visual variety without a code redeploy."
      />

      <HelpCallout>
        <p>
          The flyer renderer (Puppeteer + Tailwind) picks one asset per
          briefing slot via <code>composeFlyer()</code> — seed is{" "}
          <code>(generated_at + segment + slot kind)</code>, so the same
          edition + slot always gets the same asset, and different
          editions rotate through the pool.
        </p>
        <p>
          <strong>Photo</strong>: raster JPG/PNG/WebP, used as
          full-bleed backdrops or in the SplitImage layout.{" "}
          <strong>Ornament</strong>: single-color SVG (use{" "}
          <code>currentColor</code> for fills) — gets tinted by the
          palette accent at render time. <strong>Pattern</strong>:
          tileable SVG, used as a subtle wash behind a QuoteCard.
        </p>
        <p>
          Files go to{" "}
          <code>public/flyer-assets/uploads/&lt;uuid&gt;.&lt;ext&gt;</code>
          . In prod that subpath is bind-mounted to the host so uploads
          survive container rebuilds. Cache TTL is 60s — newly uploaded
          assets become eligible for selection within a minute (or
          immediately if a render hits the cache invalidation hook).
        </p>
      </HelpCallout>

      <Card title="Upload aset baru">
        <UploadFlyerAssetForm />
      </Card>

      <Card title={`Photos · ${byKind.photo.length}`}>
        <AssetGrid items={byKind.photo} />
      </Card>

      <Card title={`Ornaments · ${byKind.ornament.length}`}>
        <AssetGrid items={byKind.ornament} />
      </Card>

      <Card title={`Patterns · ${byKind.pattern.length}`}>
        <AssetGrid items={byKind.pattern} />
      </Card>
    </>
  );
}

type AssetRow = Awaited<ReturnType<typeof getAllAssetsFresh>>[number];

function AssetGrid({ items }: { items: AssetRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Belum ada aset di kategori ini."
        hint="Unggah lewat formulir di atas."
      />
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((a) => {
        const isUploaded = a.src.startsWith("/flyer-assets/uploads/");
        return (
          <li
            key={a.id}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="relative aspect-square w-full overflow-hidden bg-slate-50">
              {/* SVG renders crisp at any size; for JPG/PNG/WebP let the
                  browser scale. */}
              <img
                src={a.src}
                alt={a.id}
                className="absolute inset-0 h-full w-full object-cover"
                style={
                  a.kind !== "photo" ? { color: "#0f172a" } : undefined
                }
              />
              <span
                className={`absolute right-1.5 top-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  isUploaded
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {isUploaded ? "Uploaded" : "Seeded"}
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-2 p-3">
              <div>
                <p className="break-words text-xs font-bold text-slate-900">
                  {a.id}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {a.kind} · {a.aspect}
                </p>
              </div>
              {a.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {a.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <ConfirmForm
                action={deleteFlyerAssetAction}
                confirmMessage={`Hapus aset "${a.id}"? ${
                  isUploaded
                    ? "File akan dihapus dari disk."
                    : "Baris DB akan dihapus, file di repo tetap (akan kembali setelah deploy)."
                }`}
                className="mt-auto"
              >
                <input type="hidden" name="id" value={a.id} />
                <button
                  type="submit"
                  className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  <Trash2 className="h-3 w-3" />
                  Hapus
                </button>
              </ConfirmForm>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
