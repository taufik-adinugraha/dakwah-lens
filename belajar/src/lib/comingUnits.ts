import { SURAHS } from "@/lib/content";
import { CURRICULUM } from "@/lib/curriculum";

/**
 * The curriculum's units that are not one of the surahs the module has lessons for: today Ayat
 * Kursi (2:255), named by the curriculum (authored/curriculum.json `units`), so the hub and the
 * track page list it as "Segera hadir" beside the surahs that are built but not published
 * (operator 2026-10-14: "include ayat qursi as segera hadir"). Nothing is typed here: a unit
 * that gains lessons of its own (a surah in SURAHS) leaves this list by itself.
 */
export type ComingUnit = { id: string; name: string; surah: number; ayah: number | null };

export function comingUnits(): ComingUnit[] {
  const have = new Set(SURAHS.map((s) => s.surah));
  return CURRICULUM.units
    .filter((u) => u.surah !== undefined && !have.has(u.surah))
    .map((u) => ({ id: u.id, name: u.name, surah: u.surah as number, ayah: u.ayah ?? null }));
}
