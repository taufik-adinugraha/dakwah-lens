#!/usr/bin/env python3
"""Renders the narration manifests (belajar/content/narration/*.json) with ElevenLabs, with word
timings for the karaoke caption — or, by default, only says what a render would cost. Standard
library only; run from belajar/pipeline.

    python3 render_narration.py                                  # dry run: characters and cost
    python3 render_narration.py --only al-fatihah:1: --only shared:   # dry run, narrowed
    python3 render_narration.py --surah al-fatihah --skip-held     # dry run without the held-back lines
    python3 render_narration.py --render --i-approve-spend \
        --voice-id aK834gEOxQEtviMPgurT --voice-name "Kang Nandar" \
        --only al-fatihah:1: --only shared: --env-file /path/to/dakwah-lens/.env

Spending money needs BOTH --render and --i-approve-spend (house rule: every paid call waits for
the operator's explicit go). The dry run never reads the API key and never opens a connection.
A render is refused, before anything is sent, when validate_narration.py fails or when a selected
line speaks a heavy letter + a (dh zh kh gh sh th q + a: khabar, mudhaf, 'athaf) that
pronunciation.json has no operator-approved respelling for (validate_narration.heavy_latin), or an
Arabic grammar term or letter name in Latin that the dictionary does not speak (mubtada', sukun,
fa'il: validate_narration.latin_terms, rule 1). Dictionary terms marked "pending-ear-check" (added
when the operator waived the pre-render review, 2026-10-10) do render, and both the dry run and the
render list them, with the lines that say them, for the operator's ear.

The request (validate_narration.request_body, fixed there, not flags): model eleven_v3,
language_code "id" (mode A, operator 2026-10-10), stability 0.5, style 0.35, similarity_boost
0.75, use_speaker_boost true, apply_text_normalization "off"; no previous_text / next_text
(eleven_v3 rejects them). The text sent is the manifest line's `text` exactly: build_narration.py
already applied the pronunciation dictionary (grammar terms from Arabic script or a fixed
respelling, Allah → Alloh) and the speech normalisation. One request per line, to
POST /v1/text-to-speech/{voice}/with-timestamps, whose character alignment is 1:1 with the text
sent; it becomes the line's `tokens` [{t, s, e}] (validate_narration Lexicon.tokens: a dictionary
term shown in its display form, "na’t (نَعْت)", "Allah").

Output: <out>/narration/<voice-slug>/<slug>/<file>.mp3, mirroring
/belajar/media/narration/<voice-slug>/<slug>/<file>.mp3 (Caddy serves /belajar/media/* from
/srv/dakwah-lens/data/belajar-media), where <file> is validate_narration.audio_name: a hash of the
text, voice and settings. An unchanged line is never rendered (or paid for) twice — it is skipped
when the manifest already points at that file, or re-used from <file>.mp3 + <file>.json (the
alignment) when they are on disk — and a changed line gets a new file name, never a stale cache.
After each line the manifest gets audio {url, ms, sha256} (ms measured with
common.mp3_duration_ms), tokens, and voice {id, name, model}. The upload command is printed,
never run.
"""
from __future__ import annotations

import argparse
import base64
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
DEFAULT_OUT = BELAJAR / "pipeline" / "out"  # git-ignored
VM_MEDIA = "/srv/dakwah-lens/data/belajar-media"
API = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format=" + V.OUTPUT_FORMAT
PRICE_PER_1K = 0.08  # USD, eleven_v3 API list price (docs/belajar-research/audio.md §5)
MODEL = V.MODEL
request_body = V.request_body


def select(manifests: dict[str, dict], surah: str | None, only: list[str] | None) -> list[tuple[str, str, str]]:
    """(manifest name, id, spoken text) in manifest order."""
    out = []
    for name, man in manifests.items():
        if surah and name != surah:
            continue
        for lid, line in man["lines"].items():
            if only and not any(lid.startswith(p) for p in only):
                continue
            out.append((name, lid, line["text"]))
    return out


def read_api_key(env_file: Path) -> str:
    """ELEVENLABS_API_KEY from the .env file (only called for --render)."""
    if not env_file.exists():
        raise SystemExit(f"{env_file} not found; ELEVENLABS_API_KEY is read from it (--env-file)")
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if line.startswith("ELEVENLABS_API_KEY="):
            val = line.split("=", 1)[1].strip().strip("'\"")
            if val:
                return val
    raise SystemExit(f"ELEVENLABS_API_KEY is not set in {env_file}")


def synthesize(api_key: str, voice_id: str, text: str) -> tuple[bytes, dict, int | None]:
    """(mp3, alignment {characters, character_start_times_seconds, character_end_times_seconds},
    the character-cost the API reports)."""
    req = urllib.request.Request(
        API.format(voice_id=voice_id),
        data=json.dumps(request_body(text)).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = json.loads(r.read())
            cost = r.headers.get("character-cost") or r.headers.get("x-character-count")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ElevenLabs HTTP {e.code}: {e.read()[:500]!r}") from None
    audio = base64.b64decode(body.get("audio_base64") or "")
    al = body.get("alignment") or {}
    if not audio:
        raise SystemExit("ElevenLabs returned no audio")
    if "".join(al.get("characters") or []) != text:
        raise SystemExit("ElevenLabs alignment does not match the text sent character for character")
    return audio, {k: al[k] for k in ("characters", "character_start_times_seconds", "character_end_times_seconds")}, \
        (int(cost) if cost and str(cost).isdigit() else None)


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(B.dump(data), encoding="utf-8")
    os.replace(tmp, path)


def blocked(rows: list[tuple[str, str, str]], lex: V.Lexicon) -> list[tuple[str, list[str]]]:
    """Lines that may not be rendered yet: they speak a heavy letter + a (validate_narration
    heavy_latin) that pronunciation.json has no operator-approved respelling for, or an Arabic term
    or letter name in Latin (validate_narration.latin_terms)."""
    return [(lid, words) for _name, lid, text in rows if (words := V.held(text, lex))]


def unheard(rows: list[tuple[str, str, str]], manifests: dict[str, dict], lex: V.Lexicon) -> list[str]:
    """The pending-ear-check terms that the selected lines a render would send (no audio yet, not
    held back) say: "term (speak → caption): n lines"."""
    held_ids = {lid for lid, _ws in blocked(rows, lex)}
    todo = {name: {lid: manifests[name]["lines"][lid] for n, lid, _t in rows if n == name and lid not in held_ids
                   and "audio" not in manifests[name]["lines"][lid]} for name in {r[0] for r in rows}}
    use = V.pending_terms({n: {"lines": ls} for n, ls in todo.items()}, lex)
    return [f"{t.term} ({t.speak} → {t.display}): {len(use[t.term])} lines" for t in lex.terms if t.term in use]


def dry_run(rows: list[tuple[str, str, str]], manifests: dict[str, dict]) -> None:
    by: dict[str, list[int]] = {}
    for name, lid, text in rows:
        done = "audio" in manifests[name]["lines"][lid]
        v = by.setdefault(name, [0, 0, 0, 0])
        v[0] += 1
        v[1] += len(text)
        if done:
            v[2] += 1
            v[3] += len(text)
    print(f"{'manifest':12s} {'lines':>5s} {'chars':>7s} {'USD':>7s}   (lines already with audio)")
    tl = tc = 0
    for name, (n, c, nd, cd) in by.items():
        print(f"{name:12s} {n:5d} {c:7d} {c / 1000 * PRICE_PER_1K:7.2f}   ({nd} with audio, {cd} chars)")
        tl += n
        tc += c
    print(f"{'total':12s} {tl:5d} {tc:7d} {tc / 1000 * PRICE_PER_1K:7.2f}")
    todo = {text for name, lid, text in rows if "audio" not in manifests[name]["lines"][lid]}
    uc = sum(len(t) for t in todo)
    print(f"to send: {len(todo)} distinct texts, {uc} characters, USD {uc / 1000 * PRICE_PER_1K:.2f} "
          "(identical lines are rendered once and copied)")
    longest = max(rows, key=lambda r: len(r[2]), default=None)
    if longest:
        print(f"longest request: {len(longest[2])} characters ({longest[1]}); eleven_v3 limit {V.TTS_MAX}")
    print(f"estimate at USD {PRICE_PER_1K}/1K characters ({MODEL}), first take only, no retakes.")
    lex = V.load_lexicon()
    held = blocked(rows, lex)
    if held:
        words = sorted({V.key(w) for _lid, ws in held for w in ws})
        print(f"refused by --render: {len(held)} selected lines speak a heavy letter + a with no approved respelling, "
              f"or an Arabic term in Latin, not from pronunciation.json ({', '.join(words)}); narrow --only to the others")
    for row in unheard(rows, manifests, lex):
        print(f"pending ear check, rendered: {row}")
    print("dry run: nothing was sent. A render needs --render --i-approve-spend --voice-id --voice-name.")


def render(rows, manifests, lessons, args, library: dict | None = None) -> int:
    voice_slug = V.slugify(args.voice_name)
    voice = {"id": args.voice_id, "name": args.voice_name, "model": MODEL}
    root = Path(args.out).resolve() / "narration" / voice_slug
    for name in {r[0] for r in rows}:
        cur = manifests[name]["voice"]
        if cur and cur.get("id") != args.voice_id:
            if not args.switch_voice:
                raise SystemExit(f"{name}: manifest voice is {cur['name']!r} ({cur['id']}); pass --switch-voice "
                                 "to drop its audio and render it with the new voice")
            for line in manifests[name]["lines"].values():
                line.pop("audio", None)
                line.pop("tokens", None)
    forms = V.Forms(lessons)
    lex = V.load_lexicon()
    compose = V.load_compose()
    api_key = read_api_key(Path(args.env_file))
    sent = 0
    charged = 0
    unknown_cost = 0
    done: list[tuple[str, str, Path]] = []
    for name, lid, text in rows:
        if len(text) > V.TTS_MAX:
            raise SystemExit(f"{lid}: {len(text)} characters is over the {V.TTS_MAX} limit")
        line = manifests[name]["lines"][lid]
        file = V.audio_name(text, args.voice_id)
        url = f"{V.MEDIA_PREFIX}{voice_slug}/{name}/{file}.mp3"
        mp3, aligned = root / name / f"{file}.mp3", root / name / f"{file}.json"
        # A letter term's shape on screen: the focus word's, or the animation frame's (primer /
        # compose lines), exactly as build_narration and validate_narration take it.
        focus_ar = V.letters_for(name, lessons, forms, compose, library)(lid, line)
        if (line.get("audio") or {}).get("url") == url and "tokens" in line and not mp3.exists():
            print(f"skip   {lid} (the manifest already has this audio)")
            continue
        twins = sorted(root.glob(f"*/{file}.mp3"))
        if mp3.exists() and aligned.exists():
            body, al = mp3.read_bytes(), json.loads(aligned.read_text(encoding="utf-8"))
            print(f"reuse  {lid} (unchanged, {mp3.name})")
        elif twins and twins[0].with_suffix(".json").exists():
            mp3.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(twins[0], mp3)
            shutil.copyfile(twins[0].with_suffix(".json"), aligned)
            body, al = mp3.read_bytes(), json.loads(aligned.read_text(encoding="utf-8"))
            print(f"copy   {lid} (same text as {twins[0].parent.name}/{twins[0].name})")
        else:
            body, al, cost = synthesize(api_key, args.voice_id, text)
            mp3.parent.mkdir(parents=True, exist_ok=True)
            mp3.write_bytes(body)
            write_json(aligned, al)
            sent += len(text)
            if cost is None:
                unknown_cost += 1
            else:
                charged += cost
            print(f"render {lid} ({len(text)} chars, character-cost {cost})")
        line["audio"] = {"url": url, "ms": mp3_duration_ms(body)["duration_ms"], "sha256": sha256_bytes(body)}
        line["tokens"] = lex.tokens(text, al["character_start_times_seconds"], al["character_end_times_seconds"], focus_ar)
        manifests[name]["voice"] = voice
        write_json(V.NARRATION_DIR / f"{name}.json", manifests[name])
        done.append((lid, url, mp3))
    print(f"\nsent {sent} characters (≈ USD {sent / 1000 * PRICE_PER_1K:.2f} at list price); "
          f"character-cost header total {charged}" + (f" ({unknown_cost} responses without the header)" if unknown_cost else ""))
    for lid, url, mp3 in done:
        print(f"  {lid}  {url}")
    print("Next: python3 build_narration.py --check && python3 validate_narration.py, listen, then upload "
          "(not run by this script):")
    print(f"  scp -r {root} <vm-host>:{VM_MEDIA}/narration/")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Render narration with ElevenLabs (dry run by default).")
    ap.add_argument("--voice-id", help="ElevenLabs voice id (required with --render)")
    ap.add_argument("--voice-name", help="voice name; its slug names the media folder (required with --render)")
    ap.add_argument("--surah", help="one manifest: a lesson slug or 'shared' (default: all)")
    ap.add_argument("--only", metavar="ID_PREFIX", action="append",
                    help="only lines whose id starts with this (repeatable)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="print counts and cost (default)")
    mode.add_argument("--render", action="store_true", help="call ElevenLabs (needs --i-approve-spend)")
    ap.add_argument("--i-approve-spend", action="store_true", help="the operator approved this spend")
    ap.add_argument("--switch-voice", action="store_true", help="drop audio made with another voice")
    ap.add_argument("--skip-held", action="store_true",
                    help="leave out (and list) the selected lines a render would refuse, instead of refusing the run")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help=f"output root (default {DEFAULT_OUT})")
    ap.add_argument("--env-file", default=str(ENV_FILE), help=f"file with ELEVENLABS_API_KEY (default {ENV_FILE})")
    args = ap.parse_args()

    manifests, lessons, library = V.load_all()
    if args.surah and args.surah not in manifests:
        raise SystemExit(f"no manifest {args.surah!r}; have {sorted(manifests)}")
    rows = select(manifests, args.surah, args.only)
    if args.skip_held:
        out = {lid for lid, _ws in blocked(rows, V.load_lexicon())}
        if out:
            print(f"--skip-held: {len(out)} selected lines are held back and left out (caption-only until "
                  f"pronunciation.json speaks their terms or they are reworded): {', '.join(sorted(out))}")
        rows = [r for r in rows if r[1] not in out]
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
    # Pronunciation rule 2 (operator 2026-10-10): eleven_v3 reads a heavy letter + a light, so a
    # line speaking one is rendered only once the dictionary has an approved respelling for it.
    held = blocked(rows, V.load_lexicon())
    if held:
        raise SystemExit("refused, nothing was sent: these lines speak a heavy letter + a, or an Arabic term in Latin, "
                         "that pronunciation.json does not speak (add it after the operator approves its sound, reword "
                         "the line, or narrow --only):\n  " + "\n  ".join(f"{lid}: {', '.join(ws)}" for lid, ws in held[:40]))
    for row in unheard(rows, manifests, V.load_lexicon()):
        print(f"pending ear check, rendering anyway (the operator waived the pre-render review): {row}")
    return render(rows, manifests, lessons, args, library)


if __name__ == "__main__":
    sys.exit(main())
