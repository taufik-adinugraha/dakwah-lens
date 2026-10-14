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
import re
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
# (A fade needs its edge: afade=t=out with no start time fades out at 0 s and leaves the rest
# silent — the first version of this filter did, and every word came out as digital silence. The
# fades are therefore fade-INs on the file and on its reverse.)
TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,"
        "afade=t=in:d=0.02,areverse,afade=t=in:d=0.01")


def api_key(env_file: Path) -> str:
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip().removeprefix("export ").strip()
        if line.startswith("ELEVENLABS_API_KEY="):
            v = line.split("=", 1)[1].strip().strip("'\"")
            if v:
                return v
    raise SystemExit(f"ELEVENLABS_API_KEY is not set in {env_file}")


def speak(key: str, text: str, seed: int | None = None) -> bytes:
    body = {"text": text, "model_id": W.MODEL, "voice_settings": W.VOICE_SETTINGS, "apply_text_normalization": "off"}
    if seed is not None:
        body["seed"] = seed
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


# A word is levelled to the narration's own average (the v3 lines measure about -16 dB mean), so
# a word is neither lost in nor louder than the sentence around it; the limiter keeps a short
# peaky word (a single letter) from clipping.
TARGET_MEAN_DB = -16.0
GAIN_RANGE = (-6.0, 9.0)


def mean_db(path: Path) -> float:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    m = re.search(r"mean_volume: (-?[0-9.]+) dB", r)
    if not m:
        raise SystemExit(f"cannot measure the level of {path}")
    return float(m.group(1))


def encode(master: Path, final: Path, cut_tail: bool = False) -> None:
    """Trim, (cut a made-up tail,) level, and encode once (the level is measured on the trimmed
    audio, not on the mp3)."""
    tmp = final.with_suffix(".wav")
    ffmpeg("-i", str(master), "-af", TRIM, "-ar", "44100", "-ac", "1", str(tmp))
    if cut_tail:
        import wordvoice_qa as Q
        at = Q.cut_tail(tmp)
        print(f"    tail cut at {at:.0f} ms" if at is not None else "    (no tail to cut)")
    gain = min(max(TARGET_MEAN_DB - mean_db(tmp), GAIN_RANGE[0]), GAIN_RANGE[1])
    ffmpeg("-i", str(tmp), "-af", f"volume={gain:.1f}dB,alimiter=limit=0.89:level=disabled", "-b:a", "64k", str(final))
    tmp.unlink()


def duration_ms(path: Path) -> int:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       check=True, capture_output=True, text=True)
    return round(float(r.stdout.strip()) * 1000)


def place(final: Path, text: str) -> dict:
    """Name a delivery file by its content (W.url_of), drop the older takes of the same text, and
    return its manifest entry."""
    data = final.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    named = final.with_name(W.url_of(text, sha).rsplit("/", 1)[1])
    for old in final.parent.glob(f"{W.file_id(text)}*.mp3"):
        if old not in (named, final):
            old.unlink()
    if final != named:
        final.rename(named)
    return {"url": W.url_of(text, sha), "ms": duration_ms(named), "sha256": sha}


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
    ap.add_argument("--qa", action="store_true", help="screen every recorded word for a made-up sound after it (local; no spend)")
    ap.add_argument("--retake", action="store_true",
                    help="with --i-approve-spend: record again, with another seed, every word --qa flags (up to --tries)")
    ap.add_argument("--tries", type=int, default=5)
    ap.add_argument("--reencode", action="store_true",
                    help="with --render: encode every text again from its master (no API call, no spend)")
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

    if a.qa or a.retake:
        import wordvoice_qa as Q
        if manifest is None:
            raise SystemExit("content/wordvoice.json is missing")
        out = Path(a.out)

        def delivery(t: str) -> Path:
            return out / "delivery" / "kang-nandar" / "words" / manifest["words"][t]["audio"]["url"].rsplit("/", 1)[1]

        flagged = [t for t, e in manifest["words"].items() if e.get("audio") and Q.hissy_tail(delivery(t))]
        print(f"{len(flagged)} of {len(manifest['words'])} recorded words end in a made-up sound:")
        for t in flagged:
            print(f"  {len(t):3d} chars  {W.file_id(t)}  {', '.join(sorted(inv.get(t, {'?'})))}")
        if not a.retake:
            return 0
        if not a.i_approve_spend:
            raise SystemExit("--retake sends text to ElevenLabs: add --i-approve-spend once the operator has said go")
        key = api_key(Path(a.env_file))
        sent = 0
        for t in flagged:
            fid = W.file_id(t)
            master = out / "master" / f"{fid}.mp3"
            if master.exists():
                master.rename(out / "master" / f"{fid}.take0.mp3")  # a paid master is never thrown away
            for seed in range(1, a.tries + 1):
                master.write_bytes(speak(key, t, seed))
                sent += len(t)
                tmp = out / "delivery" / "kang-nandar" / "words" / f"{fid}.mp3"
                encode(master, tmp)
                if not Q.hissy_tail(tmp):
                    print(f"  {fid}: seed {seed} is clean")
                    break
                print(f"  {fid}: seed {seed} still ends in a made-up sound")
            else:
                print(f"  {fid}: NO clean take in {a.tries} seeds — needs another spelling")
            manifest["words"][t]["audio"] = place(out / "delivery" / "kang-nandar" / "words" / f"{fid}.mp3", t)
            W.MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        files = sorted(p.relative_to(out / "delivery").as_posix() for p in (out / "delivery").rglob("*.mp3"))
        (out / "delivery" / "files.txt").write_text("\n".join(files) + "\n", encoding="utf-8")
        print(f"retaken: {sent} characters sent (about USD {sent / 1000 * W.PRICE_PER_1K:.3f})")
        return 0

    if a.render:
        if not a.i_approve_spend and not a.reencode:
            raise SystemExit("--render sends text to ElevenLabs and costs money: add --i-approve-spend once the operator has said go")
        if unresolved:
            raise SystemExit(f"unresolved runs: {', '.join(unresolved)}")
        manifest = W.expected(inv, manifest)
        key = api_key(Path(a.env_file))
        out = Path(a.out)
        (out / "master").mkdir(parents=True, exist_ok=True)
        deliv = out / "delivery" / "kang-nandar" / "words"
        deliv.mkdir(parents=True, exist_ok=True)
        todo = [t for t, e in manifest["words"].items() if a.reencode or not e.get("audio")]
        if a.reencode:
            gone = [t for t in todo if not (out / "master" / f"{W.file_id(t)}.mp3").exists()]
            if gone:
                raise SystemExit(f"--reencode needs every master on disk; {len(gone)} are missing (it never sends text)")
        if a.limit:
            todo = todo[: a.limit]
        sent = 0
        for t in todo:
            fid = W.file_id(t)
            master = out / "master" / f"{fid}.mp3"
            if not master.exists():
                master.write_bytes(speak(key, W.say_of(t), W.seed_of(t)))
                sent += len(W.say_of(t))
            final = deliv / f"{fid}.mp3"
            encode(master, final, t in W.CUT_TAIL)
            manifest["words"][t]["audio"] = place(final, t)
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
