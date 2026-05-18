"""Download the Qur'an in Arabic + Indonesian + English.

Sources via AlQuran.cloud API (CC-BY data, free for non-commercial use):
  - Arabic Uthmani mushaf       → edition `quran-uthmani`
  - Indonesian translation      → edition `id.indonesian` (Indonesian Society)
  - English Sahih International → edition `en.sahih`

The Kemenag (Indonesian Ministry of Religious Affairs) translation isn't on
AlQuran.cloud — for prototype we use the AlQuran.cloud Indonesian text and
swap to Kemenag once we have a licensed copy. See PRD §09.

Output: a single JSON file at `api/data/quran.json` with one entry per ayah,
sorted by (surah, ayah):

    [
        {
            "surah": 1,
            "ayah": 1,
            "surah_name_ar": "الفاتحة",
            "surah_name_translit": "Al-Fatihah",
            "surah_name_en": "The Opening",
            "arabic": "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
            "id": "Dengan menyebut nama Allah Yang Maha Pemurah lagi Maha Penyayang.",
            "en": "In the name of Allah, the Entirely Merciful, the Especially Merciful."
        },
        ...
    ]

Run:
    cd api && uv run python -m api.scripts.download_quran
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

EDITIONS: list[tuple[str, str]] = [
    ("quran-uthmani", "arabic"),
    ("id.indonesian", "id"),
    ("en.sahih", "en"),
]

OUT_DIR = Path(__file__).resolve().parents[3] / "data"
OUT_FILE = OUT_DIR / "quran.json"
API_BASE = "https://api.alquran.cloud/v1/quran"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    merged: dict[str, dict[str, object]] = {}

    with httpx.Client(timeout=120, headers={"User-Agent": "DakwahLens/0.1"}) as client:
        for edition, key in EDITIONS:
            print(f"→ fetching {edition} …", flush=True)
            resp = client.get(f"{API_BASE}/{edition}")
            resp.raise_for_status()
            payload = resp.json()
            data = payload["data"]
            surahs = data["surahs"]
            for s in surahs:
                for a in s["ayahs"]:
                    code = f"{s['number']}:{a['numberInSurah']}"
                    entry = merged.setdefault(
                        code,
                        {
                            "surah": s["number"],
                            "ayah": a["numberInSurah"],
                            "surah_name_ar": s["name"],
                            "surah_name_translit": s["englishName"],
                            "surah_name_en": s["englishNameTranslation"],
                        },
                    )
                    entry[key] = a["text"]

    out = sorted(merged.values(), key=lambda x: (int(x["surah"]), int(x["ayah"])))  # type: ignore[arg-type]

    OUT_FILE.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"✓ wrote {len(out):,} ayat → {OUT_FILE}")
    print(f"  (~{OUT_FILE.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
