#!/usr/bin/env python3
"""Renders the narration manifests (belajar/content/narration/*.json) with ElevenLabs — or, by
default, only says what a render would cost. Standard library only; run from belajar/pipeline.

    python3 render_narration.py                         # dry run: characters and cost per surah
    python3 render_narration.py --surah al-fatihah --only al-fatihah:1:   # dry run, narrowed
    python3 render_narration.py --render --i-approve-spend \
        --voice-id <id> --voice-name "<name>" --surah al-fatihah --only al-fatihah:1:

Spending money needs BOTH --render and --i-approve-spend (house rule: every paid call waits for
the operator's explicit go). The dry run never reads the API key and never opens a connection.

House settings (fixed here, not flags): model eleven_v3, stability 0.5, style 0.35,
similarity_boost 0.75, use_speaker_boost true, apply_text_normalization "off". All normalisation
is done in Python first: build_narration.py writes speech-ready text (numbers spelled out,
abbreviations and honorifics expanded, no Arabic, no transliteration) and
build_narration.tts_text() applies the speech-only respellings (Allah → Alloh) and drops
brackets and quotes just before the request. One request per line (eleven_v3 takes at most
5,000 characters; lines are at most 400). previous_text / next_text are not sent (eleven_v3
rejects them).

Output: <out>/narration/<voice-slug>/<slug>/<file>.mp3, mirroring
/belajar/media/narration/<voice-slug>/<slug>/<file>.mp3, where <file> is the line id with every
":" written "__" (validate_narration.media_file; al-fatihah:1:w1 → al-fatihah__1__w1.mp3: colons
break scp and the app's same-origin path rule). Caddy serves /belajar/media/* from
/srv/dakwah-lens/data/belajar-media). After each line the manifest gets
audio {url, ms, sha256} (ms measured with common.mp3_duration_ms) and voice {id, name, model}.
<out>/narration/<voice-slug>/render-ledger.json records, per id, the sha256 of the exact text
sent and the settings, so an unchanged line is never rendered (or paid for) twice; identical
texts in one voice are rendered once and copied. The upload command is printed, never run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

import build_narration as B
import validate_narration as V
from common import BELAJAR, mp3_duration_ms, sha256_bytes

REPO = BELAJAR.parent
ENV_FILE = REPO / ".env"
DEFAULT_OUT = BELAJAR / "pipeline" / "out" / "media"  # git-ignored (out/)
VM_MEDIA = "/srv/dakwah-lens/data/belajar-media"
API = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
PRICE_PER_1K = 0.08  # USD, eleven_v3 API list price (docs/belajar-research/audio.md §5)
MODEL = V.MODEL
VOICE_SETTINGS = {"stability": 0.5, "style": 0.35, "similarity_boost": 0.75, "use_speaker_boost": True}
TEXT_NORMALIZATION = "off"


def settings_key() -> str:
    blob = json.dumps({"model": MODEL, "voice_settings": VOICE_SETTINGS,
                       "apply_text_normalization": TEXT_NORMALIZATION}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def request_body(text: str) -> dict:
    """Exactly what is POSTed for one line."""
    return {
        "text": text,
        "model_id": MODEL,
        "voice_settings": dict(VOICE_SETTINGS),
        "apply_text_normalization": TEXT_NORMALIZATION,
    }


def select(manifests: dict[str, dict], surah: str | None, only: str | None) -> list[tuple[str, str, str]]:
    """(manifest name, id, speech text) in manifest order."""
    out = []
    for name, man in manifests.items():
        if surah and name != surah:
            continue
        for lid, line in man["lines"].items():
            if only and not lid.startswith(only):
                continue
            out.append((name, lid, B.tts_text(line["text"])))
    return out


def read_api_key() -> str:
    """ELEVENLABS_API_KEY from the repo .env (only called for --render)."""
    if not ENV_FILE.exists():
        raise SystemExit(f"{ENV_FILE} not found; ELEVENLABS_API_KEY is read from it")
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if line.startswith("ELEVENLABS_API_KEY="):
            val = line.split("=", 1)[1].strip().strip("'\"")
            if val:
                return val
    raise SystemExit(f"ELEVENLABS_API_KEY is not set in {ENV_FILE}")


def synthesize(api_key: str, voice_id: str, text: str) -> bytes:
    req = urllib.request.Request(
        API.format(voice_id=voice_id),
        data=json.dumps(request_body(text)).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ElevenLabs HTTP {e.code}: {e.read()[:500]!r}") from None
    if not body:
        raise SystemExit("ElevenLabs returned no audio")
    return body


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(B.dump(data), encoding="utf-8")
    os.replace(tmp, path)


def dry_run(rows: list[tuple[str, str, str]], manifests: dict[str, dict]) -> None:
    by: dict[str, list[int]] = {}
    for name, lid, tts in rows:
        done = "audio" in manifests[name]["lines"][lid]
        v = by.setdefault(name, [0, 0, 0, 0])
        v[0] += 1
        v[1] += len(tts)
        if done:
            v[2] += 1
            v[3] += len(tts)
    print(f"{'manifest':12s} {'lines':>5s} {'chars':>7s} {'USD':>7s}   (lines already with audio)")
    tl = tc = 0
    for name, (n, c, nd, cd) in by.items():
        print(f"{name:12s} {n:5d} {c:7d} {c / 1000 * PRICE_PER_1K:7.2f}   ({nd} with audio, {cd} chars)")
        tl += n
        tc += c
    print(f"{'total':12s} {tl:5d} {tc:7d} {tc / 1000 * PRICE_PER_1K:7.2f}")
    todo = {tts for name, lid, tts in rows if "audio" not in manifests[name]["lines"][lid]}
    uc = sum(len(t) for t in todo)
    print(f"to send: {len(todo)} distinct texts, {uc} characters, USD {uc / 1000 * PRICE_PER_1K:.2f} "
          "(identical lines are rendered once and copied)")
    longest = max(rows, key=lambda r: len(r[2]), default=None)
    if longest:
        print(f"longest request: {len(longest[2])} characters ({longest[1]}); eleven_v3 limit {V.TTS_MAX}")
    print(f"estimate at USD {PRICE_PER_1K}/1K characters ({MODEL}), first take only, no retakes; "
          "lines that already have audio are skipped by --render when the ledger matches.")
    print("dry run: nothing was sent. A render needs --render --i-approve-spend --voice-id --voice-name.")


def render(rows, manifests, args) -> int:
    voice_slug = V.slugify(args.voice_name)
    voice = {"id": args.voice_id, "name": args.voice_name, "model": MODEL}
    root = Path(args.out).resolve() / "narration" / voice_slug
    ledger_path = root / "render-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {}
    skey = settings_key()
    for name in {r[0] for r in rows}:
        cur = manifests[name]["voice"]
        if cur and cur.get("id") != args.voice_id:
            if not args.switch_voice:
                raise SystemExit(f"{name}: manifest voice is {cur['name']!r} ({cur['id']}); pass --switch-voice "
                                 "to drop its audio and render it with the new voice")
            for line in manifests[name]["lines"].values():
                line.pop("audio", None)
    api_key = read_api_key()
    by_text: dict[str, Path] = {}
    sent = 0
    for name, lid, tts in rows:
        if len(tts) > V.TTS_MAX:
            raise SystemExit(f"{lid}: {len(tts)} characters is over the {V.TTS_MAX} limit")
        text_sha = hashlib.sha256(tts.encode("utf-8")).hexdigest()
        out_path = root / name / V.media_file(lid)
        url = f"{V.MEDIA_PREFIX}{voice_slug}/{name}/{V.media_file(lid)}"
        line = manifests[name]["lines"][lid]
        rec = ledger.get(lid)
        if (rec and rec.get("text_sha256") == text_sha and rec.get("settings") == skey
                and rec.get("voice_id") == args.voice_id and out_path.exists()
                and sha256_bytes(out_path.read_bytes()) == rec.get("mp3_sha256")):
            body = out_path.read_bytes()
            print(f"skip   {lid} (unchanged)")
        elif text_sha in by_text:
            body = by_text[text_sha].read_bytes()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(by_text[text_sha], out_path)
            print(f"copy   {lid} (same text as an earlier line)")
        else:
            body = synthesize(api_key, args.voice_id, tts)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(body)
            sent += len(tts)
            print(f"render {lid} ({len(tts)} chars)")
        by_text.setdefault(text_sha, out_path)
        ms = mp3_duration_ms(body)["duration_ms"]
        mp3_sha = sha256_bytes(body)
        line["audio"] = {"url": url, "ms": ms, "sha256": mp3_sha}
        manifests[name]["voice"] = voice
        ledger[lid] = {"text_sha256": text_sha, "settings": skey, "voice_id": args.voice_id, "mp3_sha256": mp3_sha}
        root.mkdir(parents=True, exist_ok=True)
        write_json(ledger_path, ledger)
        write_json(V.NARRATION_DIR / f"{name}.json", manifests[name])
    print(f"\nsent {sent} characters (≈ USD {sent / 1000 * PRICE_PER_1K:.2f}).")
    print("Next: python3 validate_narration.py, listen, then upload (not run by this script):")
    print(f"  scp -r {root} <vm-host>:{VM_MEDIA}/narration/")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Render narration with ElevenLabs (dry run by default).")
    ap.add_argument("--voice-id", help="ElevenLabs voice id (required with --render)")
    ap.add_argument("--voice-name", help="voice name; its slug names the media folder (required with --render)")
    ap.add_argument("--surah", help="one manifest: a lesson slug or 'shared' (default: all)")
    ap.add_argument("--only", metavar="ID_PREFIX", help="only lines whose id starts with this")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="print counts and cost (default)")
    mode.add_argument("--render", action="store_true", help="call ElevenLabs (needs --i-approve-spend)")
    ap.add_argument("--i-approve-spend", action="store_true", help="the operator approved this spend")
    ap.add_argument("--switch-voice", action="store_true", help="drop audio made with another voice")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help=f"media root (default {DEFAULT_OUT})")
    args = ap.parse_args()

    manifests, lessons, library = V.load_all()
    if args.surah and args.surah not in manifests:
        raise SystemExit(f"no manifest {args.surah!r}; have {sorted(manifests)}")
    rows = select(manifests, args.surah, args.only)
    if not rows:
        raise SystemExit("no lines selected")
    if not args.render:
        dry_run(rows, manifests)
        return 0
    if not args.i_approve_spend:
        raise SystemExit("--render costs money: add --i-approve-spend once the operator has approved this run")
    if not (args.voice_id and args.voice_name):
        raise SystemExit("--render needs --voice-id and --voice-name")
    errs = V.check(manifests, lessons, library)
    if errs:
        raise SystemExit("validate_narration.py fails; fix that first:\n  " + "\n  ".join(errs[:20]))
    return render(rows, manifests, args)


if __name__ == "__main__":
    sys.exit(main())
