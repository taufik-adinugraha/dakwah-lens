"""Tag every Qur'anic verse with topical keywords via Gemini 2.0 Flash.

Why
---
The semantic retrieval scores from `embed_quran.py` sit around 20-35% for
modern English queries (e.g. "raising teenagers in the digital age") because
classical scripture vocabulary and modern phrasing live in different parts
of the embedding space.

This script asks Gemini Flash for 4-6 modern topical keywords per ayah —
"family", "parenting", "tarbiyah", "burnout", "halal-investing", etc. —
which bridge the gap. `embed_quran.py` then includes those tags in each
ayah's embedded text, so modern queries match the tags directly.

Resumability
------------
Saves progress to `api/data/quran-tags.json` after every batch. Re-running
the script picks up where it left off. Safe to Ctrl-C.

Rate limits
-----------
Gemini 2.0 Flash free tier: 15 requests/minute, 1,500 requests/day.
At 10 verses/batch we need ~624 requests — finishes well under daily limit,
~50 minutes wall-clock at the 5-second pause between batches.

Cost
----
$0 on the free tier.

Run
---
    cd api && uv run python -m api.scripts.tag_quran
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import structlog
from google import genai
from google.genai import types
from pydantic import BaseModel

from api.config import settings

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"  # higher free-tier RPD than 2.5-flash; faster too
BATCH_SIZE = 15  # verses per Gemini call
# No explicit sleep — each request itself takes 8-15s, so we're naturally
# at ~4-6 RPM (well under the free-tier 15 RPM cap).
SLEEP_BETWEEN_BATCHES = 0.0
MAX_RETRIES = 3

QURAN_JSON = Path(__file__).resolve().parents[3] / "data" / "quran.json"
TAGS_JSON = Path(__file__).resolve().parents[3] / "data" / "quran-tags.json"


class VerseTag(BaseModel):
    surah: int
    ayah: int
    tags: list[str]


SYSTEM_PROMPT = """You are tagging Qur'anic verses for a semantic search system used by da'i (Islamic preachers) in Indonesia.

For each verse, return 4-6 topical keywords that capture what it teaches. Tags should bridge modern queries (like "raising teenagers in the digital age" or "halal investing for Gen Z") to classical scripture text.

Use:
- Lowercase English where possible.
- Mix in established Islamic terms when they fit better: tarbiyah, akhlaq, muamalah, sabr, hidayah, dakwah, riba, halal, haram, ihsan, taqwa, ukhuwah, tawakkul, hikmah, zakat, sadaqah, rizq, ibadah, aqidah, fitrah.
- Focus on what the verse TEACHES — themes, principles, audiences, applications — not just the literal subject.
- For very short or purely contextual verses (single-word oaths, opening letters like Alif-Lam-Mim, pure conjunctions), use just ["context"].

Examples:

Verse: "And do not throw yourselves into destruction with your own hands."
Tags: ["self-preservation", "balance", "burnout", "akhlaq", "responsibility"]

Verse: "Invite to the way of your Lord with wisdom and good instruction."
Tags: ["dawah", "hikmah", "communication", "preaching", "ethics", "methodology"]

Verse: "And He gives provision from where you do not expect."
Tags: ["rizq", "tawakkul", "trust-in-Allah", "provision", "patience"]

Verse: "And those who are patient, seeking the countenance of their Lord, and establish prayer..."
Tags: ["sabr", "ibadah", "patience", "mental-health", "perseverance"]

Verse: "Those who consume interest cannot stand on the Day of Resurrection..."
Tags: ["riba", "muamalah", "finance", "halal-investing", "economic-ethics"]

Return only valid JSON in the schema you've been given. No prose, no markdown.
"""


def format_batch(verses: list[dict]) -> str:
    lines: list[str] = []
    for v in verses:
        lines.append(f"Verse {v['surah']}:{v['ayah']}")
        lines.append(f"  EN: {v['en']}")
        lines.append(f"  ID: {v['id']}")
        lines.append("")
    return "\n".join(lines)


def save_tags(tagged: dict[str, list[str]]) -> None:
    out = [
        {
            "surah": int(k.split(":")[0]),
            "ayah": int(k.split(":")[1]),
            "tags": tags,
        }
        for k, tags in sorted(
            tagged.items(),
            key=lambda x: (int(x[0].split(":")[0]), int(x[0].split(":")[1])),
        )
    ]
    TAGS_JSON.write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    if not settings.gemini_api_key:
        print("❌ GEMINI_API_KEY not set in .env.", file=sys.stderr)
        raise SystemExit(1)

    verses = json.loads(QURAN_JSON.read_text(encoding="utf-8"))
    log.info("tag.start", total=len(verses))

    # Resume from existing tags file if present.
    tagged: dict[str, list[str]] = {}
    if TAGS_JSON.exists():
        existing = json.loads(TAGS_JSON.read_text(encoding="utf-8"))
        for entry in existing:
            tagged[f"{entry['surah']}:{entry['ayah']}"] = entry["tags"]
        log.info("tag.resumed", already_tagged=len(tagged))

    untagged = [v for v in verses if f"{v['surah']}:{v['ayah']}" not in tagged]
    log.info("tag.todo", remaining=len(untagged))

    if not untagged:
        print(f"✓ All {len(tagged):,} verses already tagged. Nothing to do.")
        return

    client = genai.Client(api_key=settings.gemini_api_key)
    start = time.time()
    batches_done = 0

    for i in range(0, len(untagged), BATCH_SIZE):
        batch = untagged[i : i + BATCH_SIZE]
        prompt = (
            f"{SYSTEM_PROMPT}\n\n"
            f"Now tag these {len(batch)} verses:\n\n"
            f"{format_batch(batch)}"
        )

        result: list[VerseTag] | None = None
        for attempt in range(MAX_RETRIES):
            try:
                response = client.models.generate_content(
                    model=MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=list[VerseTag],
                    ),
                )
                if response.parsed:
                    result = response.parsed  # type: ignore[assignment]
                else:
                    raw = json.loads(response.text)
                    result = [VerseTag.model_validate(item) for item in raw]
                break
            except Exception as e:
                wait = 2**attempt
                log.warning(
                    "tag.retry",
                    attempt=attempt + 1,
                    error=str(e)[:200],
                    wait_s=wait,
                )
                time.sleep(wait)

        if not result:
            log.error(
                "tag.batch_failed",
                batch_start=f"{batch[0]['surah']}:{batch[0]['ayah']}",
            )
            time.sleep(SLEEP_BETWEEN_BATCHES)
            continue

        # Store results, defaulting to ["context"] for anything Gemini missed.
        returned_keys = set()
        for vt in result:
            key = f"{vt.surah}:{vt.ayah}"
            tagged[key] = [t.lower().strip() for t in vt.tags if t.strip()]
            returned_keys.add(key)

        for v in batch:
            key = f"{v['surah']}:{v['ayah']}"
            if key not in returned_keys:
                tagged[key] = ["context"]
                log.warning("tag.missing_default", verse=key)

        save_tags(tagged)

        batches_done += 1
        elapsed = time.time() - start
        log.info(
            "tag.batch",
            done=len(tagged),
            total=len(verses),
            batch=batches_done,
            elapsed_s=round(elapsed, 1),
        )

        # Rate-limit pause.
        if i + BATCH_SIZE < len(untagged):
            time.sleep(SLEEP_BETWEEN_BATCHES)

    elapsed = time.time() - start
    print()
    print(f"✓ Tagged {len(tagged):,} verses")
    print(f"  elapsed     : {elapsed:>10.1f} s")
    print(f"  output file : {TAGS_JSON}")


if __name__ == "__main__":
    main()
