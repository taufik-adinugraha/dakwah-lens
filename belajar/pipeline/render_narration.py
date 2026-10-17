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

Output, two files per line (operator 2026-10-11, "do all three": the narration is delivered at
64 kbps mono, half the bytes of the render):

- the MASTER, as ElevenLabs returned it (mp3 44.1 kHz 128 kbps mono), at
  <out>/narration/<voice-slug>/<slug>/<file>.mp3 with its alignment <file>.json, where <file> is
  validate_narration.audio_name: a hash of the text, voice and settings. Never served. An unchanged
  line is never rendered (or paid for) twice — it is skipped when the manifest already names its
  delivered file, or re-used from <file>.mp3 + <file>.json when they are on disk — and a changed
  line gets a new file name, never a stale cache;
- the DELIVERED file, made from the master right away by encode_narration.deliver (ffmpeg, fixed
  flags, no cost), at <out>/delivery/<voice-slug>/<slug>/<name>.mp3, mirroring
  /belajar/media/narration/<voice-slug>/<slug>/<name>.mp3 (Caddy serves /belajar/media/* from
  /srv/dakwah-lens/data/belajar-media), where <name> is validate_narration.delivery_name: a hash of
  the master's name, the delivery format and the delivered bytes.

AUDIO AND TOKENS ALWAYS COME FROM ONE TAKE (review 2026-10-11). The tokens are derived, every time,
from the alignment .json beside the master. The delivered file the manifest already names is kept
(encode_narration.standing: the published name stands, whatever this machine's ffmpeg would write
today) only when the line was not rendered in this run AND those tokens have the timings the
manifest already has, which is to say the master on disk is still the take that file was made
from. In every other case the master is delivered anew, so the line gets its audio and its
timings together: a fresh render, a master and its .json replaced by hand (a retake put in their
place), or a second line of the same text whose first line was just retaken. Replacing a master by
hand is therefore finished by running --render on its line (--only <id>): nothing is sent while
the master and its .json are on disk. encode_narration.py --reencode alone is not the way: it
never touches tokens.

A kept take whose delivered file is lost or damaged is made again from the master only as the
bytes the manifest publishes (the same sha256, so the same name). When this ffmpeg writes other
bytes, the run stops and says to fetch the published file back from the server: another ffmpeg
build must not rename a published file in passing.

A TAKE CUT SHORT IS REFUSED (operator 2026-10-17: "the voice is cut slightly before the sentence
finished"). ElevenLabs sometimes returns audio that ends before its own alignment does — the
master of al-fatihah:0:primer:1 is 4.049 s, its last letter aligned to end at 4.16 s — so the last
word is cut in the recording itself (validate_narration.CUT_TOLERANCE_MS, cut_ms). A fresh take is
written beside the master as <file>.new.mp3 and measured (ffprobe) BEFORE it takes the master's
place: cut, it is kept as <file>.cut-<k>.mp3 (+ .json; paid for, there to listen to), the line gets
nothing — no master, no delivery, no manifest entry — and the run ends with exit 1, listing it.
Running the same command again renders one more take of it (and pays again); nothing is retried
by itself. A take already on disk (reuse, or a twin copied from another manifest) is measured the
same way: a cut one is never used again — it is moved aside as <file>.cut-<k>.mp3 and the line is
rendered anew. build_narration.py does not carry a cut take over in a manifest either, so a line
whose take was cut has no audio and is what a render of it sends (the RETAKE of a cut line: select
it with --only and render; the dry run counts it).

After each line the manifest gets audio {url, ms, sha256} of the DELIVERED file (ms measured with
ffprobe), tokens, and voice {id, name, model}. A render therefore needs ffmpeg and ffprobe, and
says so before anything is sent; the dry run needs neither. The upload is printed, never run: the
list encode_narration.py --check --list writes, and those files only (never the masters, never the
whole directory); README, "Before a deploy".
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

import encode_narration as E
import validate_narration as V
from common import BELAJAR

REPO = BELAJAR.parent
ENV_FILE = REPO / ".env"
DEFAULT_OUT = E.DEFAULT_OUT  # git-ignored: narration/ (masters) and delivery/ (what is uploaded)
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


write_json = E.write_json


def cut_short(mp3: Path, al: dict) -> int | None:
    """How many ms a take on disk ends before its own alignment's last character does, when that is
    more than validate_narration.CUT_TOLERANCE_MS — ElevenLabs cut the take short (operator
    2026-10-17: "the voice is cut slightly before the sentence finished"; al-fatihah:0:primer:1,
    4.049 s of audio, its last letter aligned to end at 4.16 s) — else None (a whole take). The
    length is the master's, by ffprobe, as encode_narration.deliver measures it."""
    ends = al.get("character_end_times_seconds") or []
    if not ends:
        return None
    ms = E.probe(mp3)["ms"]
    tail = [{"e": max(ends)}]
    return V.cut_ms(tail, ms) if V.is_cut(tail, ms) else None


def set_aside(mp3: Path, why: str) -> Path:
    """Moves a take (<file>.mp3 and its .json alignment) out of the master's place, to
    <file-stem>.<why>-<k>.mp3 (+ .json) beside it, k the first number free: a paid take is never
    overwritten or deleted, and never found again as the master of its text. Returns the new path."""
    stem = mp3.name.split(".", 1)[0]
    k = 1
    while (mp3.parent / f"{stem}.{why}-{k}.mp3").exists() or (mp3.parent / f"{stem}.{why}-{k}.json").exists():
        k += 1
    dest = mp3.parent / f"{stem}.{why}-{k}.mp3"
    os.replace(mp3, dest)
    if mp3.with_suffix(".json").exists():
        os.replace(mp3.with_suffix(".json"), dest.with_suffix(".json"))
    return dest


def blocked(rows: list[tuple[str, str, str]], lex: V.Lexicon, manifests: dict[str, dict] | None = None) -> list[tuple[str, list[str]]]:
    """Lines that may not be rendered yet: they speak a heavy letter + a (validate_narration
    heavy_latin) that pronunciation.json has no operator-approved respelling for, an Arabic term or
    letter name in Latin (validate_narration.latin_terms), or — read from the line's caption when
    `manifests` is given — a named Qur'anic word whose sound waits for the operator (named_held)."""
    def words(name: str, lid: str, text: str) -> list[str]:
        line = (manifests or {}).get(name, {}).get("lines", {}).get(lid)
        return V.held_line(line, lex) if isinstance(line, dict) else V.held(text, lex)
    return [(lid, ws) for name, lid, text in rows if (ws := words(name, lid, text))]


def unheard(rows: list[tuple[str, str, str]], manifests: dict[str, dict], lex: V.Lexicon) -> list[str]:
    """The pending-ear-check terms that the selected lines a render would send (no audio yet, not
    held back) say: "term (speak → caption): n lines"."""
    held_ids = {lid for lid, _ws in blocked(rows, lex, manifests)}
    todo = {name: {lid: manifests[name]["lines"][lid] for n, lid, _t in rows if n == name and lid not in held_ids
                   and "audio" not in manifests[name]["lines"][lid]} for name in {r[0] for r in rows}}
    use = V.pending_terms({n: {"lines": ls} for n, ls in todo.items()}, lex)
    named = V.pending_named({n: {"lines": ls} for n, ls in todo.items()}, lex)
    return ([f"{t.term} ({t.speak} → {t.display}): {len(use[t.term])} lines" for t in lex.terms if t.term in use]
            + [f"{tr} (named word, said {lex.named[tr].speak}): {len(ids)} lines" for tr, ids in named.items()])


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
    print(f"a take ElevenLabs cuts short (it ends more than {V.CUT_TOLERANCE_MS} ms before its own last word) is refused "
          "and kept aside, never put in a manifest: its line stays without audio, and running the same command again "
          "renders (and pays for) one more take of it.")
    print(f"each render ({V.OUTPUT_FORMAT} master) is then encoded once to {V.DELIVERY_FORMAT} for delivery "
          "(encode_narration.py: ffmpeg on this machine, no cost).")
    lex = V.load_lexicon()
    held = blocked(rows, lex, manifests)
    if held:
        words = sorted({V.key(w) for _lid, ws in held for w in ws})
        print(f"refused by --render: {len(held)} selected lines speak a heavy letter + a with no approved respelling, "
              f"an Arabic term in Latin, or a named word with no spelling in its `named` list, not from pronunciation.json "
              f"({', '.join(words)}); narrow --only to the others")
    for row in unheard(rows, manifests, lex):
        print(f"pending ear check, rendered: {row}")
    print("dry run: nothing was sent. A render needs --render --i-approve-spend --voice-id --voice-name.")


def render(rows, manifests, lessons, args, library: dict | None = None) -> int:
    voice_slug = V.slugify(args.voice_name)
    voice = {"id": args.voice_id, "name": args.voice_name, "model": MODEL}
    out = Path(args.out).resolve()
    root = out / E.MASTERS / voice_slug
    # Before the key is read or a character is paid for: a render that cannot be delivered is refused.
    print(f"delivery encode ({V.DELIVERY_FORMAT}): {E.require_tools()}")
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
    refused: list[tuple[str, int, Path]] = []  # (line, ms short, where the cut take was kept)
    for name, lid, text in rows:
        if len(text) > V.TTS_MAX:
            raise SystemExit(f"{lid}: {len(text)} characters is over the {V.TTS_MAX} limit")
        line = manifests[name]["lines"][lid]
        file = V.audio_name(text, args.voice_id)
        mp3, aligned = root / name / f"{file}.mp3", root / name / f"{file}.json"
        # A letter term's shape on screen: the focus word's, or the animation frame's (primer /
        # compose lines), exactly as build_narration and validate_narration take it.
        focus_ar = V.letters_for(name, lessons, forms, compose, library)(lid, line)
        if V.is_delivery(line.get("audio"), voice, name, text) and "tokens" in line and not mp3.exists():
            print(f"skip   {lid} (the manifest already has this audio)")
            continue
        twins = sorted(root.glob(f"*/{file}.mp3"))
        fresh = False  # a master rendered in this run: delivered anew, whatever the manifest named before
        al = None
        # A take on disk (this manifest's master, or a twin of the same text in another manifest)
        # is used only when it is whole: a take ElevenLabs cut short (cut_short) is never used
        # again — the line is rendered anew below, and the cut master is kept aside, not deleted.
        on_disk = mp3 if mp3.exists() and aligned.exists() else \
            twins[0] if twins and twins[0].with_suffix(".json").exists() else None
        if on_disk is not None:
            take_al = json.loads(on_disk.with_suffix(".json").read_text(encoding="utf-8"))
            short = cut_short(on_disk, take_al)
            if short is None and on_disk == mp3:
                al = take_al
                print(f"reuse  {lid} (unchanged, {mp3.name})")
            elif short is None:
                mp3.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(on_disk, mp3)
                shutil.copyfile(on_disk.with_suffix(".json"), aligned)
                al = take_al
                print(f"copy   {lid} (same text as {on_disk.parent.name}/{on_disk.name})")
            else:
                aside = set_aside(mp3, "cut") if on_disk == mp3 else on_disk
                print(f"cut    {lid} ({on_disk.name} ends {short} ms before its last word does: not used again"
                      + (f"; kept as {aside.name}" if on_disk == mp3 else "") + "); a new take is rendered")
        if al is None:
            body, new_al, cost = synthesize(api_key, args.voice_id, text)
            sent += len(text)
            if cost is None:
                unknown_cost += 1
            else:
                charged += cost
            # The new take is checked BEFORE it takes the master's place: a take ElevenLabs cut short
            # never becomes the master, never gets delivered, never enters the manifest. It is kept
            # beside the master as <file>.cut-<k>.mp3 (+ .json), paid for and there to listen to.
            mp3.parent.mkdir(parents=True, exist_ok=True)
            new = mp3.with_name(f"{file}.new.mp3")
            new.write_bytes(body)
            write_json(new.with_suffix(".json"), new_al)
            short = cut_short(new, new_al)
            if short is not None:
                kept = set_aside(new, "cut")
                refused.append((lid, short, kept))
                print(f"REFUSED {lid} ({len(text)} chars, character-cost {cost}): ElevenLabs cut this take, it ends {short} ms "
                      f"before its last word does; kept as {kept.name}, the manifest is not changed")
                continue
            os.replace(new, mp3)
            os.replace(new.with_suffix(".json"), aligned)
            al, fresh = new_al, True
            print(f"render {lid} ({len(text)} chars, character-cost {cost})")
        tokens = lex.tokens(text, al["character_start_times_seconds"], al["character_end_times_seconds"], focus_ar,
                            V.named_in_display(line.get("display"), lex))
        # The manifest describes what is served: the master encoded for delivery (64 kbps mono), not
        # the master. Refused (SystemExit) if the encode drifts or a token no longer fits; the paid
        # master stays on disk, so a re-run re-uses it.
        # Audio and tokens come from one take. The tokens above are the take on disk. The delivered
        # file the manifest already names is that same take only if the master was not rendered in
        # this run and the manifest's tokens have these timings (a master replaced by hand, or
        # rendered a moment ago for another line of the same text, has others). Then it is kept when
        # it is here and intact: its name is published, and another ffmpeg build would write other
        # bytes under a new one (encode_narration: a published name stands; review 2026-10-11). If
        # it is lost or damaged it is made again as the published bytes or refused (`published`).
        # Any other take is delivered from the master, under the name its own bytes give.
        published = line.get("audio") if V.is_delivery(line.get("audio"), voice, name, text) else None
        same_take = not fresh and published is not None and E.timings(line.get("tokens")) == E.timings(tokens)
        kept = E.standing(line, voice, name, out) if same_take else None
        if kept:
            audio, path = line["audio"], kept
        else:
            delivered = E.deliver(mp3, text, voice, name, tokens, out, published=published if same_take else None)
            audio, path = delivered.audio, delivered.path
        line["audio"] = audio
        line["tokens"] = tokens
        manifests[name]["voice"] = voice
        write_json(V.NARRATION_DIR / f"{name}.json", manifests[name])
        done.append((lid, audio["url"], path))
    print(f"\nsent {sent} characters (≈ USD {sent / 1000 * PRICE_PER_1K:.2f} at list price); "
          f"character-cost header total {charged}" + (f" ({unknown_cost} responses without the header)" if unknown_cost else ""))
    for lid, url, mp3 in done:
        print(f"  {lid}  {url}")
    if refused:
        # Paid for and refused: the line keeps no audio (caption-only). Another run of the same
        # command renders it again — one more take, one more charge, per line and per run.
        print(f"\nREFUSED: {len(refused)} take(s) ElevenLabs cut short (each ends more than {V.CUT_TOLERANCE_MS} ms before its "
              "own last word does); nothing of them is in a manifest. Listen to them if you like, then run the same "
              "command again for another take (it costs as much again):")
        for lid, short, kept in refused:
            print(f"  {lid}: {short} ms short, kept as {kept}")
    # The upload sends the files the manifests reference and no others: the list is written by
    # encode_narration.py --check --list, which exits 1 if a referenced file is not here as described.
    print("Next: python3 build_narration.py --check && python3 validate_narration.py, listen; then, before the deploy "
          "(README, \"Before a deploy\"; not run by this script):")
    print("\n".join(E.upload_steps(out)))
    return 1 if refused else 0


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
        out = {lid for lid, _ws in blocked(rows, V.load_lexicon(), manifests)}
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
    held = blocked(rows, V.load_lexicon(), manifests)
    if held:
        raise SystemExit("refused, nothing was sent: these lines speak a heavy letter + a, an Arabic term in Latin, or a "
                         "named word that pronunciation.json does not speak (add it, as pending-ear-check or approved, reword "
                         "the line, or narrow --only):\n  " + "\n  ".join(f"{lid}: {', '.join(ws)}" for lid, ws in held[:40]))
    for row in unheard(rows, manifests, V.load_lexicon()):
        print(f"pending ear check, rendering anyway (the operator waived the pre-render review): {row}")
    return render(rows, manifests, lessons, args, library)


if __name__ == "__main__":
    sys.exit(main())
