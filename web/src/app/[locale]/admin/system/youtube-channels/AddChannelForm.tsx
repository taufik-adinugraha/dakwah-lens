import { addYoutubeChannel } from "../actions";

/**
 * Manual-add form for a single YouTube channel. The everyday tool is
 * the `seed_youtube_channels.py` script (which resolves names → IDs
 * via search.list). This form is for one-off additions where the
 * curator already knows the channel_id.
 */
const CATEGORIES: { value: string; label: string }[] = [
  { value: "religious", label: "Religious / Dakwah" },
  { value: "family", label: "Family / Vlog Keluarga" },
  { value: "youth", label: "Youth / Lifestyle" },
  { value: "muamalah", label: "Muamalah" },
  { value: "social_justice", label: "Social Justice / Accountability" },
  { value: "health", label: "Health" },
  { value: "education", label: "Education" },
  { value: "cultural", label: "Cultural / Budaya" },
];

export function AddChannelForm() {
  return (
    <form
      action={addYoutubeChannel}
      className="grid gap-3 sm:grid-cols-[1.5fr_2fr_1fr_1.5fr_auto]"
    >
      <input
        type="text"
        name="channel_id"
        placeholder="UC… (24-char channel ID)"
        required
        pattern="^UC[A-Za-z0-9_-]{22}$"
        title="YouTube channel IDs are 24 chars and start with 'UC'."
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
      />
      <input
        type="text"
        name="name"
        placeholder="Display name (e.g. Adi Hidayat Official)"
        required
        maxLength={255}
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
      />
      <input
        type="text"
        name="handle"
        placeholder="@handle (optional)"
        maxLength={128}
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
      />
      <select
        name="category"
        required
        defaultValue=""
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
      >
        <option value="" disabled>
          Category…
        </option>
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800"
      >
        Add
      </button>
    </form>
  );
}
