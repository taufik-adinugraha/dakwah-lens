#!/usr/bin/env python3
"""The DELIVERY encode of the narration audio: every rendered line's 128 kbps master
(pipeline/out/narration, render_narration.py) re-encoded once to 64 kbps mono, the file the learner
downloads. No ElevenLabs call, no re-recording, no cost: ffmpeg on this machine. Run from
belajar/pipeline:

    python3 encode_narration.py                    # encode what the manifests reference, update them
    python3 encode_narration.py --check            # the same, writing nothing: exit 1 if anything would change
    python3 encode_narration.py --list files.txt   # also write the delivered files' paths (for the upload)

Why (operator 2026-10-11, "how to reduce the loading time?" → "do all three"): the narration was
served as rendered, mono at 128 kbps, twice what speech needs; the opening line alone was 372 KB,
2–3 seconds on a weak signal. Delivered at 64 kbps each line arrives about twice as fast. The
masters stay where they are, with their alignment files, and are never served: a later change of
the delivery format re-encodes from them, not from a lossy copy.

The encode (ENCODE, fixed here, not flags): libmp3lame, 64 kbps CBR, mono, 44.1 kHz, LAME quality
2, no metadata, no ID3 tag, bitexact, one thread. The Info frame is kept: it carries the encoder
delay and padding, so a player starts both files at the same instant of sound and the karaoke
tokens ([{t, s, e}], seconds from the start of the clip) stay as rendered. The same master gives
the same bytes on this machine (--check re-encodes and compares).

Output: <out>/delivery/<voice-slug>/<slug>/<file>.mp3 (git-ignored), mirroring
/belajar/media/narration/<voice-slug>/<slug>/<file>.mp3, where <file> is
validate_narration.delivery_name: a hash of the master's name (text, voice, settings), the
delivery format and the sha256 of the delivered bytes. It is never the master's name, and no name
ever means two files, so the server can tell browsers to keep them for good. The manifest line's
audio {url, ms, sha256} then describes the DELIVERED file: its url, the sha256 of its bytes and its
length measured with ffprobe (rounded to the millisecond, as before).

What must hold, or the step fails and no manifest is written:
- the delivered file is MP3, 64 kbps, mono, 44.1 kHz, and decodes without an error
  (ffmpeg -v error -i f -f null -);
- its length is within MAX_DRIFT_MS (80 ms) of its master's;
- every karaoke token still fits: none ends later after the end of the delivered file than it did
  after the end of the master. (A token that already ran past the end of its MASTER is ElevenLabs'
  own alignment, not the encode; it is listed, and validate_narration.check_tokens bounds it.)

render_narration.py runs `deliver` on every line it renders, so the next surah is delivered at
64 kbps without a separate step. A machine without the masters (CI) needs none of this:
validate_narration.py checks the manifests alone.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import build_narration as B
import validate_narration as V
from common import BELAJAR, mp3_duration_ms, sha256_bytes

DEFAULT_OUT = BELAJAR / "pipeline" / "out"  # git-ignored
MASTERS = "narration"  # <out>/narration/<voice-slug>/<slug>/<audio_name>.mp3 (+ .json alignment)
DELIVERY = "delivery"  # <out>/delivery/<voice-slug>/<slug>/<delivery_name>.mp3
VM_MEDIA = "/srv/dakwah-lens/data/belajar-media"

# The delivery format, V.DELIVERY_FORMAT ("mp3_44100_64_mono"), spelled out for ffmpeg. A change
# here is a change of format: give DELIVERY_FORMAT a new tag with it, so every file is renamed.
CODEC = "libmp3lame"
BITRATE = 64_000  # CBR
SAMPLE_RATE = 44_100
CHANNELS = 1
LAME_QUALITY = "2"  # LAME -q 2 (its high-quality setting); speed does not matter for short clips
ENCODE = (
    "-map", "0:a:0", "-vn", "-map_metadata", "-1", "-map_chapters", "-1",
    "-c:a", CODEC, "-b:a", str(BITRATE), "-ac", str(CHANNELS), "-ar", str(SAMPLE_RATE),
    "-compression_level", LAME_QUALITY,
    "-flags", "+bitexact", "-fflags", "+bitexact",  # no encoder version strings: same bytes each run
    "-id3v2_version", "0",  # no ID3 tag: the file starts with its first frame
    "-write_xing", "1",  # the Info frame: frame count, encoder delay and padding
    "-f", "mp3",
)
MAX_DRIFT_MS = 80  # delivered length against the master's
_ROUNDING = 0.0005  # seconds: half of the millisecond `ms` is rounded to


def encode_args(master: Path, out: Path) -> list[str]:
    return ["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-y", "-threads", "1", "-i", str(master), *ENCODE, str(out)]


def _run(args: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, capture_output=True, check=False)
    except FileNotFoundError:
        raise SystemExit(f"{args[0]} not found: the delivery encode needs ffmpeg and ffprobe on PATH") from None


def require_tools() -> str:
    """ffmpeg with libmp3lame, and ffprobe: checked before a render sends (and pays for) anything.
    Returns the ffmpeg version line."""
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} not found: the delivery encode needs ffmpeg and ffprobe on PATH")
    if CODEC not in _run(["ffmpeg", "-hide_banner", "-encoders"]).stdout.decode("utf-8", "replace"):
        raise SystemExit(f"this ffmpeg has no {CODEC} encoder")
    return _run(["ffmpeg", "-version"]).stdout.decode("utf-8", "replace").splitlines()[0]


def _encode_to(master: Path, out: Path) -> bytes:
    """Encodes to a real file, not a pipe: the muxer goes back to fill in the Info frame."""
    r = _run(encode_args(master, out))
    if r.returncode or r.stderr.strip() or not out.exists():
        raise SystemExit(f"ffmpeg could not encode {master}: {r.stderr.decode('utf-8', 'replace').strip()[:400]}")
    return out.read_bytes()


def encode(master: Path) -> bytes:
    """The delivered bytes of one master: a function of its bytes, ENCODE and this ffmpeg build."""
    with tempfile.TemporaryDirectory(prefix="belajar-delivery-") as tmp:
        return _encode_to(master, Path(tmp) / "delivery.mp3")


def probe(path: Path) -> dict:
    """{seconds, ms, codec, sample_rate, channels, bit_rate} of an audio file, by ffprobe."""
    r = _run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
              "format=duration:stream=codec_name,sample_rate,channels,bit_rate", "-of", "json", str(path)])
    try:
        data = json.loads(r.stdout)
        st, seconds = data["streams"][0], float(data["format"]["duration"])
        return {"seconds": seconds, "ms": round(seconds * 1000), "codec": st["codec_name"],
                "sample_rate": int(st["sample_rate"]), "channels": int(st["channels"]), "bit_rate": int(st["bit_rate"])}
    except (ValueError, KeyError, IndexError, TypeError):
        raise SystemExit(f"ffprobe could not read {path}: {r.stderr.decode('utf-8', 'replace').strip()[:400]}") from None


def decode_error(path: Path) -> str | None:
    """None when the whole file decodes cleanly, else what ffmpeg said."""
    r = _run(["ffmpeg", "-nostdin", "-hide_banner", "-v", "error", "-i", str(path), "-f", "null", "-"])
    said = r.stderr.decode("utf-8", "replace").strip()
    return (said or f"ffmpeg exit {r.returncode}") if r.returncode or said else None


def format_problems(info: dict) -> list[str]:
    """What a delivered file's ffprobe reading has that DELIVERY_FORMAT does not."""
    want = {"codec": "mp3", "sample_rate": SAMPLE_RATE, "channels": CHANNELS, "bit_rate": BITRATE}
    return [f"{k} is {info.get(k)!r}, not {v!r}" for k, v in want.items() if info.get(k) != v]


def fit_problems(tokens: list[dict], master_s: float, delivered_s: float) -> list[str]:
    """Why a delivered file of `delivered_s` seconds may not stand in for its master of `master_s`:
    its length drifted more than MAX_DRIFT_MS, or a karaoke token no longer fits (it ends later
    after the end of the delivered file than it did after the end of the master)."""
    errs = []
    drift = (delivered_s - master_s) * 1000
    if abs(drift) > MAX_DRIFT_MS:
        errs.append(f"its length drifted {drift:+.0f} ms from the master's (limit {MAX_DRIFT_MS} ms)")
    for i, tk in enumerate(tokens):
        before, after = max(0.0, tk["e"] - master_s), max(0.0, tk["e"] - delivered_s)
        if after > before + _ROUNDING:
            errs.append(f"token {i} ({tk['t']!r}) ends at {tk['e']:.3f} s and no longer fits: the delivered file is "
                        f"{delivered_s:.3f} s, the master {master_s:.3f} s")
            break
    return errs


def past_master_ms(tokens: list[dict], master_s: float) -> int:
    """How far the last token runs past the end of the MASTER (0: it fits). ElevenLabs' alignment
    sometimes ends its last character a little after the audio does; not the encode's doing."""
    return max(0, round((max(tk["e"] for tk in tokens) - master_s) * 1000)) if tokens else 0


@dataclass
class Delivered:
    audio: dict  # the manifest line's audio: {url, ms, sha256} of the delivered file
    path: Path  # where it is (or, with write=False, would be) on this machine
    size: int
    master_size: int
    drift_ms: float  # delivered length − master length
    past_master_ms: int


def master_path(root: Path, voice: dict, slug: str, text: str) -> Path:
    return root / MASTERS / V.slugify(voice["name"]) / slug / f"{V.audio_name(text, voice['id'])}.mp3"


def delivery_path(root: Path, url: str) -> Path:
    """The file a manifest url names, under <out>/delivery."""
    return root / DELIVERY / url[len(V.MEDIA_PREFIX):]


def deliver(master: Path, text: str, voice: dict, slug: str, tokens: list[dict], root: Path, *, write: bool = True) -> Delivered:
    """Encodes one line's master, checks the result (format, decode, drift, token fit; SystemExit
    on any, and nothing is kept) and, unless `write` is False, puts it at
    <root>/delivery/<voice-slug>/<slug>/<delivery_name>.mp3. Returns the manifest's audio entry for
    it and what was measured."""
    with tempfile.TemporaryDirectory(prefix="belajar-delivery-") as tmp:
        made = Path(tmp) / "delivery.mp3"
        body = _encode_to(master, made)
        info, was = probe(made), probe(master)
        errs = format_problems(info)
        walked = mp3_duration_ms(body)["duration_ms"]  # its frames counted, without ffprobe
        if abs(walked - info["ms"]) > 1:
            errs.append(f"ffprobe measures {info['ms']} ms but its frames add up to {walked} ms")
        bad = decode_error(made)
        if bad:
            errs.append(f"does not decode cleanly: {bad[:200]}")
        errs += fit_problems(tokens, was["seconds"], info["seconds"])
    if errs:
        raise SystemExit(f"delivery of {master} ({V.DELIVERY_FORMAT}) refused: " + "; ".join(errs))
    sha = sha256_bytes(body)
    url = V.delivery_url(voice, slug, text, sha)
    out = delivery_path(root, url)
    if write and not (out.exists() and out.read_bytes() == body):
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp_out = out.with_suffix(".mp3.tmp")
        tmp_out.write_bytes(body)
        os.replace(tmp_out, out)
    return Delivered({"url": url, "ms": info["ms"], "sha256": sha}, out, len(body), master.stat().st_size,
                     (info["seconds"] - was["seconds"]) * 1000, past_master_ms(tokens, was["seconds"]))


def verify_kept(line: dict, path: Path) -> list[str]:
    """A delivered file whose master is not on this machine: the manifest must already describe it."""
    body = path.read_bytes()
    info = probe(path)
    errs = format_problems(info)
    if sha256_bytes(body) != line["audio"]["sha256"]:
        errs.append("its sha256 is not the manifest's")
    if info["ms"] != line["audio"]["ms"]:
        errs.append(f"it is {info['ms']} ms, the manifest says {line['audio']['ms']}")
    bad = decode_error(path)
    if bad:
        errs.append(f"does not decode cleanly: {bad[:200]}")
    return errs


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(B.dump(data), encoding="utf-8")
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description="Encode the narration masters to the delivery format (64 kbps mono).")
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 if a manifest or a delivered file would change")
    ap.add_argument("--list", metavar="FILE", help="write the delivered files the manifests reference, one path per "
                    "line relative to the delivery directory")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help=f"output root holding narration/ and delivery/ (default {DEFAULT_OUT})")
    ap.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 2), help="encodes at a time")
    args = ap.parse_args()
    root = Path(args.out).resolve()
    print(f"{require_tools()}\nformat {V.DELIVERY_FORMAT}: ffmpeg {' '.join(ENCODE)}")

    manifests, _lessons, _library = V.load_all()
    # One job per file: identical lines of a manifest share theirs.
    jobs: dict[tuple[str, str], tuple[Path, dict, list[str]]] = {}
    for name, man in manifests.items():
        voice = man.get("voice")
        for lid, line in man["lines"].items():
            if "audio" not in line:
                continue
            if not voice:
                raise SystemExit(f"{lid}: audio but the manifest names no voice (validate_narration.py)")
            master = master_path(root, voice, name, line["text"])
            jobs.setdefault((name, master.name), (master, line, []))[2].append(lid)
    if not jobs:
        print("no line has audio: nothing to deliver")
        return 0

    def one(job: tuple[str, str]) -> tuple[str, Delivered | None, list[str]]:
        """("encoded", the delivered file, []) | ("kept" | "absent", None, []) | ("failed", None, why)."""
        name, _file = job
        master, line, lids = jobs[job]
        voice = manifests[name]["voice"]
        if master.exists():
            try:
                return "encoded", deliver(master, line["text"], voice, name, line.get("tokens") or [], root,
                                          write=not args.check), []
            except SystemExit as e:
                return "failed", None, [f"{lids[0]}: {e}"]
        # No master on this machine (another one rendered it): the line must already be delivered.
        if not V.is_delivery(line["audio"], voice, name, line["text"]):
            return "failed", None, [f"{lids[0]}: no master at {master}, and the manifest does not name a delivered file"]
        kept = delivery_path(root, line["audio"]["url"])
        if not kept.exists():
            return "absent", None, []
        errs = [f"{lids[0]}: {kept}: {e}" for e in verify_kept(line, kept)]
        return ("failed" if errs else "kept"), None, errs

    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        results = dict(zip(jobs, pool.map(one, jobs)))

    problems = [e for _how, _d, errs in results.values() for e in errs]
    count = {how: sum(1 for h, _d, _e in results.values() if h == how) for how in ("encoded", "kept", "absent", "failed")}
    changed: dict[str, int] = {}
    files: set[str] = set()  # relative to the delivery directory
    done: list[tuple[str, Delivered]] = []
    for (name, file), (_how, d, _errs) in results.items():
        _master, line, lids = jobs[(name, file)]
        files.add((d.audio if d else line["audio"])["url"][len(V.MEDIA_PREFIX):])
        if d is None:
            continue
        done.append((lids[0], d))
        for lid in lids:
            if manifests[name]["lines"][lid]["audio"] != d.audio:
                changed[name] = changed.get(name, 0) + 1
                manifests[name]["lines"][lid]["audio"] = dict(d.audio)

    print(f"\n{sum(len(lids) for _m, _l, lids in jobs.values())} lines with audio, {len(jobs)} files: "
          f"{count['encoded']} encoded from their masters"
          + (f", {count['kept']} kept (no master here; the file matches the manifest)" if count["kept"] else "")
          + (f", {count['absent']} with neither master nor delivered file on this machine (not checked)" if count["absent"] else "")
          + (f", {count['failed']} failed" if count["failed"] else ""))
    if done:
        before, after = sum(d.master_size for _l, d in done), sum(d.size for _l, d in done)
        big = max(done, key=lambda x: x[1].master_size)
        worst = max(done, key=lambda x: abs(x[1].drift_ms))
        print(f"bytes: {before:,} (masters, {V.OUTPUT_FORMAT}) → {after:,} ({V.DELIVERY_FORMAT}), {after / before:.1%}")
        print(f"largest: {big[0]} {big[1].master_size:,} → {big[1].size:,} bytes ({big[1].path.name})")
        print(f"length drift, delivered − master: max {abs(worst[1].drift_ms):.3f} ms ({worst[0]}); limit {MAX_DRIFT_MS} ms")
        print(f"{len(done)} of {len(done)} decode cleanly, are {V.DELIVERY_FORMAT} by ffprobe, and hold their tokens as the master does")
        for lid, d in done:
            if d.past_master_ms:
                print(f"  note: {lid}: its last token already ends {d.past_master_ms} ms after its MASTER does "
                      "(ElevenLabs' alignment, not the encode; unchanged)")
    if problems:
        print(f"\nFAIL: {len(problems)} problem(s); no manifest written")
        for e in problems:
            print("  -", e)
        return 1
    if args.list:
        Path(args.list).write_text("".join(f"{f}\n" for f in sorted(files)), encoding="utf-8")
        print(f"listed {len(files)} files in {args.list}")
    stale = sorted(str(p.relative_to(root / DELIVERY)) for p in (root / DELIVERY).glob("*/*/*.mp3")
                   if str(p.relative_to(root / DELIVERY)) not in files) if (root / DELIVERY).exists() else []
    if stale:
        print(f"{len(stale)} files under {root / DELIVERY} are no longer referenced by a manifest (older texts or "
              "takes); they are not listed for the upload")
    if args.check:
        missing = [lid for lid, d in done if not d.path.exists() or sha256_bytes(d.path.read_bytes()) != d.audio["sha256"]]
        if changed or missing:
            print("\nout of date: " + ", ".join([f"{n} ({c} lines)" for n, c in changed.items()]
                                                + ([f"{len(missing)} delivered files not on disk as encoded"] if missing else []))
                  + "; run encode_narration.py")
            return 1
        print("\nOK: the manifests describe the delivered files (re-encoded and compared)")
        return 0
    for name, n in changed.items():
        write_json(V.NARRATION_DIR / f"{name}.json", manifests[name])
        print(f"{name}: {n} lines now name their delivered file -> {(V.NARRATION_DIR / f'{name}.json').relative_to(BELAJAR.parent)}")
    if not changed:
        print("the manifests already describe these files")
    print(f"\ndelivery directory: {root / DELIVERY}")
    print("Next: python3 build_narration.py --check && python3 validate_narration.py, then upload (not run by this script):")
    for slug in sorted({f.split("/")[0] for f in files}):
        print(f"  scp -r {root / DELIVERY / slug} <vm-host>:{VM_MEDIA}/narration/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
