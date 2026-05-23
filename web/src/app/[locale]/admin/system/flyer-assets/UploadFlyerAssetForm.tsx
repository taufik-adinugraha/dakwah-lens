"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";

import { uploadFlyerAssetAction } from "./actions";

/**
 * Upload form for a new flyer asset.
 *
 * Server action handles all validation; we surface its error code as a
 * friendly inline message. On success the page revalidates server-side
 * via revalidatePath() and the new row appears in the list.
 *
 * Client component because we need useTransition + local form-error
 * state. Plain HTML <form> submits the FormData directly to the action.
 */

const ERROR_MESSAGES: Record<string, string> = {
  file_required: "Pilih file terlebih dahulu.",
  file_too_large: "Ukuran file maksimal 5 MB.",
  invalid_id: "ID harus kebab-case (huruf kecil + tanda hubung, 1-40 karakter).",
  invalid_kind: "Pilih jenis aset (foto / ornamen / pola).",
  invalid_aspect: "Pilih aspek (1:1 / wide / tall).",
  kind_mime_mismatch:
    "Tipe file tidak cocok dengan jenis. Foto = jpg/png/webp; ornamen/pola = svg.",
  too_many_tags: "Maksimal 12 tag.",
  invalid_tag: "Tag harus kebab-case (huruf kecil + tanda hubung).",
  id_taken: "ID sudah dipakai aset lain. Pilih ID berbeda.",
};

export function UploadFlyerAssetForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        await uploadFlyerAssetAction(formData);
        setSuccess(`Asset "${formData.get("id")}" berhasil diunggah.`);
        formRef.current?.reset();
      } catch (e) {
        const code = e instanceof Error ? e.message : "unknown";
        setError(ERROR_MESSAGES[code] ?? `Gagal: ${code}`);
      }
    });
  }

  return (
    <form ref={formRef} action={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700">
            ID
          </span>
          <input
            name="id"
            type="text"
            required
            placeholder="contoh: masjid-istiqlal"
            pattern="[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            kebab-case, unik. Dipakai compose() sebagai seed.
          </span>
        </label>

        <label className="block">
          <span className="block text-xs font-semibold text-slate-700">
            Jenis
          </span>
          <select
            name="kind"
            required
            defaultValue=""
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="" disabled>
              Pilih…
            </option>
            <option value="photo">📷 Foto (jpg/png/webp)</option>
            <option value="ornament">✦ Ornamen (svg, tint via currentColor)</option>
            <option value="pattern">▦ Pola (svg, tileable)</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-semibold text-slate-700">
            Aspek
          </span>
          <select
            name="aspect"
            required
            defaultValue="1:1"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="1:1">1:1 (persegi)</option>
            <option value="wide">Wide (horizontal)</option>
            <option value="tall">Tall (vertikal)</option>
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-semibold text-slate-700">
            Tag (pisah koma)
          </span>
          <input
            name="tags"
            type="text"
            placeholder="mosque, warm, contemplative"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Untuk filter mood di compose(). Maks 12, kebab-case.
          </span>
        </label>
      </div>

      <label className="block">
        <span className="block text-xs font-semibold text-slate-700">File</span>
        <input
          name="file"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100"
        />
        <span className="mt-1 block text-[11px] text-slate-500">
          Maks 5 MB. Foto = jpg/png/webp · Ornamen/Pola = svg.
        </span>
      </label>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" />
        {pending ? "Mengunggah…" : "Unggah Aset"}
      </button>
    </form>
  );
}
