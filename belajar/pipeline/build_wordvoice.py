#!/usr/bin/env python3
"""content/wordvoice.json: the voice of every Qur'anic word and form (pipeline/wordvoice.py).

  build_wordvoice.py                     dry run: what would be voiced, characters, list price; nothing written
  build_wordvoice.py --write             (re)write the manifest from the content, keeping recordings
  build_wordvoice.py --check [--require-audio]
                                         CI: the manifest is what --write would produce, and well-formed
  build_wordvoice.py --render --i-approve-spend [--env-file F] [--out DIR] [--limit N]
                                         records every text without audio (the spend is the operator's go:
                                         ELEVENLABS_API_KEY from the .env file), trims, encodes the delivery
                                         file, and writes the manifest

Delivery (the same media store as the narration; nothing to configure on the server):
  cd <out>/delivery && COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T files.txt | ssh <vm-host> \\
     'sudo -n -u deploy tar -x --skip-old-files -C /srv/dakwah-lens/data/belajar-media/narration'
then every listed file is fetched from https://dakwah-lens.id/belajar/media/narration/… and its
sha256 compared with the manifest's.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import wordvoice as W

ENV_FILE = W.BELAJAR.parent / ".env"
DEFAULT_OUT = W.BELAJAR / "pipeline" / "out" / "words"
# A word is trimmed of the silence the model puts before and after it (a clean word is the point
# of this module), with a few ms of fade so no click is left at either edge.
TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,afade=t=out:d=0.02")


def api_key(env_file: Path) -> str:
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip().removeprefix("export ").strip()
        if line.startswith("ELEVENLABS_API_KEY="):
            v = line.split("=", 1)[1].strip().strip("'\"")
            if v:
                return v
    raise SystemExit(f"ELEVENLABS_API_KEY is not set in {env_file}")


def speak(key: str, text: str) -> bytes:
    body = {"text": text, "model_id": W.MODEL, "voice_settings": W.VOICE_SETTINGS, "apply_text_normalization": "off"}
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{W.VOICE_ID}?output_format={W.MASTER_FORMAT}",
        data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"ElevenLabs {e.code}: {e.read()[:300]!r}")


def ffmpeg(*a: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)


def duration_ms(path: Path) -> int:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       check=True, capture_output=True, text=True)
    return round(float(r.stdout.strip()) * 1000)


def dry(inv: dict[str, set[str]], unresolved: list[str], manifest: dict | None) -> None:
    have = {t for t, e in ((manifest or {}).get("words") or {}).items() if e.get("audio")}
    by: dict[str, set[str]] = {}
    for t, origins in inv.items():
        for o in origins:
            by.setdefault(o, set()).add(t)
    for o, ts in sorted(by.items()):
        print(f"  {o:14s} {len(ts):4d} texts {sum(len(t) for t in ts):6d} chars")
    todo = [t for t in inv if t not in have]
    chars = sum(len(t) for t in todo)
    print(f"{len(inv)} distinct texts, {len(have)} already recorded, {len(todo)} to record: {chars} characters, "
          f"USD {chars / 1000 * W.PRICE_PER_1K:.2f} at list price ({W.MODEL}, first take, no retakes)")
    if unresolved:
        print(f"unresolved runs (a word of the run is in no content file): {', '.join(unresolved)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--require-audio", action="store_true")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--i-approve-spend", action="store_true")
    ap.add_argument("--env-file", default=str(ENV_FILE))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--limit", type=int, default=0, help="record at most N texts (a trial)")
    a = ap.parse_args()

    inv, unresolved = W.inventory()
    manifest = W.load_manifest()

    if a.check:
        errs = [f"unresolved run {r}" for r in unresolved]
        if manifest is None:
            errs.append("content/wordvoice.json is missing")
        else:
            errs += W.problems(manifest, inv, a.require_audio)
            if manifest != W.expected(inv, manifest):
                errs.append("content/wordvoice.json is not what build_wordvoice.py --write produces")
        if errs:
            print("wordvoice manifest problems:\n  " + "\n  ".join(errs[:40]))
            return 1
        n = sum(1 for e in manifest["words"].values() if e.get("audio"))
        print(f"wordvoice manifest up to date: {len(manifest['words'])} texts, {n} recorded")
        return 0

    if a.render:
        if not a.i_approve_spend:
            raise SystemExit("--render sends text to ElevenLabs and costs money: add --i-approve-spend once the operator has said go")
        if unresolved:
            raise SystemExit(f"unresolved runs: {', '.join(unresolved)}")
        manifest = W.expected(inv, manifest)
        key = api_key(Path(a.env_file))
        out = Path(a.out)
        (out / "master").mkdir(parents=True, exist_ok=True)
        deliv = out / "delivery" / "kang-nandar" / "words"
        deliv.mkdir(parents=True, exist_ok=True)
        todo = [t for t, e in manifest["words"].items() if not e.get("audio")]
        if a.limit:
            todo = todo[: a.limit]
        sent = 0
        for t in todo:
            fid = W.file_id(t)
            master = out / "master" / f"{fid}.mp3"
            if not master.exists():
                master.write_bytes(speak(key, t))
                sent += len(t)
            final = deliv / f"{fid}.mp3"
            ffmpeg("-i", str(master), "-af", TRIM, "-ar", "44100", "-ac", "1", "-b:a", "64k", str(final))
            ms = duration_ms(final)
            manifest["words"][t]["audio"] = {"url": W.url_of(t), "ms": ms, "sha256": hashlib.sha256(final.read_bytes()).hexdigest()}
            W.MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        files = sorted(p.relative_to(out / "delivery").as_posix() for p in (out / "delivery").rglob("*.mp3"))
        (out / "delivery" / "files.txt").write_text("\n".join(files) + "\n", encoding="utf-8")
        print(f"recorded {len(todo)} texts, {sent} characters sent (about USD {sent / 1000 * W.PRICE_PER_1K:.2f}); "
              f"delivery list: {out / 'delivery' / 'files.txt'} ({len(files)} files)")
        return 0

    if a.write:
        W.MANIFEST.write_text(json.dumps(W.expected(inv, manifest), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {W.MANIFEST.relative_to(W.BELAJAR.parent)}: {len(inv)} texts")
        return 0

    dry(inv, unresolved, manifest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
