"""Writes belajar/pipeline/authored/kosakata_meanings.json from a run's final entries."""
import json, sys
from pathlib import Path
run = Path(sys.argv[1]); final_name = sys.argv[2]; out = Path(sys.argv[3])
ev = json.loads((run / "evidence.json").read_text(encoding="utf-8"))
final = json.loads((run / final_name).read_text(encoding="utf-8"))
review = {"passed": "passed", "corrected": "corrected", "flagged": "disputed"}
lemmas = {}
for e in ev:
    x = final[e["id"]]
    lemmas[e["lemma_bw"]] = {
        "review": review[x["status"]],
        "senses": [{"id": s["gloss_id"], "en": s["gloss_en"], "ayat": s["ayat"]} for s in x["entry"]["senses"]],
    }
doc = {
    "_about": "Meanings of every QAC lemma, written with Claude outside this pipeline (belajar/authoring/kosakata_generate.py): Sonnet 5.5 wrote each from a sample of up to 12 ayat with QuranEnc and Saheeh International, Opus 5.5 checked and corrected, every correction was re-checked, then a second full check, then a third check of ranks 1 to 2,000 for what a learner memorises, with every correction read and decided by a person (authoring/kosakata_rulings_levels.json). Dibantu AI, bukan fatwa. review: passed, corrected, or disputed (still questioned after the checks, read by Claude Opus 5.5 in session). Edit here, then run build_kosakata.py.",
    "lemmas": lemmas,
}
out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("lemmas", len(lemmas), "bytes", out.stat().st_size)
