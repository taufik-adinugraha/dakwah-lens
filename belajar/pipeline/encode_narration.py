#!/usr/bin/env python3
"""The DELIVERY encode of the narration audio: every rendered line's 128 kbps master
(pipeline/out/narration, render_narration.py) re-encoded once to 64 kbps mono, the file the learner
downloads. No ElevenLabs call, no re-recording, no cost: ffmpeg on this machine. Run from
belajar/pipeline:

    python3 encode_narration.py                    # deliver what the manifests reference, update them
    python3 encode_narration.py --check            # the same, writing nothing: exit 1 if anything would change
    python3 encode_narration.py --list files.txt   # also write the delivered files' paths (for the upload);
                                                   # exit 1 if a referenced file is not on this machine
    python3 encode_narration.py --check --reencode # every master encoded again and compared with what is on disk

Before a deploy (README, "Narasi", Delivery, "Before a deploy"): `--check --list <file>` must exit 0,
then the listed files, and only those, are uploaded with the command this script prints, and each
is checked as served before the deploy. CI has no audio and cannot see a file that was not uploaded.

Why (operator 2026-10-11, "how to reduce the loading time?" → "do all three"): the narration was
served as rendered, mono at 128 kbps, twice what speech needs; the opening line alone was 372 KB,
2–3 seconds on a weak signal. Delivered at 64 kbps each line arrives about twice as fast. The
masters stay where they are, with their alignment files, and are never served: a later change of
the delivery format re-encodes from them, not from a lossy copy.

The encode (ENCODE, fixed here, not flags): libmp3lame, 64 kbps CBR, mono, 44.1 kHz, LAME quality
2, no metadata, no ID3 tag, bitexact, one thread. The Info frame is kept: it carries the encoder
delay and padding, so a player starts both files at the same instant of sound and the karaoke
tokens ([{t, s, e}], seconds from the start of the clip) stay as rendered. The same master gives
the same bytes on this machine and this ffmpeg build (--check --reencode encodes again and compares).

A PUBLISHED NAME STANDS (review 2026-10-11). The name carries the delivered bytes, and another
ffmpeg or LAME build may write other bytes for the same master. So a line whose manifest entry
already names a delivered file, with that file on disk and intact (verify_kept: sha256, length,
format, decode), is KEPT, master on disk or not: an upgraded encoder renames nothing, learners
download nothing twice, and nothing has to be uploaded again. Only a line without a valid delivered
file (a new or changed text, a file lost or damaged) is encoded. A lost or damaged file is made
again only as the bytes the manifest publishes (its sha256): when this ffmpeg writes other bytes
for the master, the step fails and says to fetch the published file back from the server, instead
of renaming it without a word. --reencode encodes every line whose master is here and takes
whatever comes out: it is for a deliberate change of ENCODE, which is a new format (give
DELIVERY_FORMAT a new tag with it), and for nothing else.

THIS STEP NEVER TOUCHES TOKENS. A master replaced by hand (a retake put in the master's place with
its alignment .json) is therefore NOT a case for --reencode alone: that would deliver the new
take's audio with the old take's word timings, and the validators notice that only when the
timings run more than validate_narration.CUT_TOLERANCE_MS (20 ms) past the end of the new audio. Run
render_narration.py --render on that line first (--only <line id>; nothing is sent or paid for
while the master and its .json are on disk): it re-derives the tokens from the .json and delivers
the master, so audio and tokens come from one take. Lines of one manifest that share a text share
one master and one delivered file, so they must carry the same token timings; when they do not
(one of them was retaken, the other still has the old take), this step refuses that file and names
the lines to render, instead of giving the new audio to a line that has the old timings.

Level: every delivered file is 0.45 dB quieter than its master (review 2026-10-11, all 335 pairs
decoded: gain 0.944–0.953, mean 0.9495, the same below 4 kHz, zero lag). That is LAME itself, which
scales its input by 0.95 at bitrates like this one (the same flags on shared:start: 0.950 at 64, 96
and 128 kbps, 1.000 at 256 kbps). It is uniform and inaudible, not a fault to fix. Do not
compensate with a volume filter: the loudest delivered file already peaks at 0.95 of full scale,
so ×1/0.95 would clip it — and any change of level renames every file.

Output: <out>/delivery/<voice-slug>/<slug>/<file>.mp3 (git-ignored), mirroring
/belajar/media/narration/<voice-slug>/<slug>/<file>.mp3, where <file> is
validate_narration.delivery_name: a hash of the master's name (text, voice, settings), the
delivery format and the sha256 of the delivered bytes. It is never the master's name, and no name
ever means two files, so the server can tell browsers to keep them for good. The manifest line's
audio {url, ms, sha256} then describes the DELIVERED file: its url, the sha256 of its bytes and its
length measured with ffprobe (rounded to the millisecond, as before).

What must hold of a file this step encodes, or the step fails and no manifest is written:
- the delivered file is MP3, 64 kbps, mono, 44.1 kHz, and decodes without an error
  (ffmpeg -v error -i f -f null -);
- its length is within MAX_DRIFT_MS (80 ms) of its master's;
- every karaoke token still fits: none ends later after the end of the delivered file than it did
  after the end of the master. (A token that already ran past the end of its MASTER is ElevenLabs'
  own alignment, not the encode: up to validate_narration.CUT_TOLERANCE_MS it is listed as a note;
  more is a take ElevenLabs cut short — operator 2026-10-17, "the voice is cut slightly before the
  sentence finished" — and it is refused, as validate_narration.check_tokens refuses it in a
  manifest.) This holds for every line that shares the file: their timings are the same, or the
  file is refused;
- a file the manifest already names is made again as the published bytes, or not at all (above).

render_narration.py runs `deliver` on every line it renders, so the next surah is delivered at
64 kbps without a separate step. A machine without the masters (CI) needs none of this:
validate_narration.py checks the manifests alone.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
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
VM_MEDIA = "/srv/dakwah-lens/data/belajar-media"  # on the VM; Caddy serves it as SITE/belajar/media
VM_MEDIA_OWNER = "deploy"  # the user that directory belongs to (deploy/belajar/deploy.sh); the upload writes as it
SITE = "https://dakwah-lens.id"  # SITE + a manifest's audio url is where the delivered file is served
UPLOAD_LIST = "files.txt"  # the list --list writes, by the README's convention inside <out>/delivery

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


def timings(tokens: list[dict] | None) -> list[tuple[float, float]]:
    """The (start, end) of each karaoke token: what tells one take of a text from another. The token
    texts are left out on purpose: build_narration.py re-derives them when a display form changes,
    while the timings come from the alignment ElevenLabs returned with the audio and from nowhere else."""
    return [(tk["s"], tk["e"]) for tk in tokens or []]


def take_problems(lines: list[dict], master: Path) -> list[str]:
    """Whether the token timings of `lines` are the take now at `master` ([]: they are). Every
    token's start and end is copied, rounded to the millisecond, from the alignment .json that
    ElevenLabs returned with the master and render_narration.py keeps beside it; a time the .json
    does not have belongs to another take. This step never writes tokens, so without this check a
    master replaced by hand and re-encoded (--reencode) would play the new take under the old
    take's timings, and CI could not tell unless they ran past the end of the audio (review
    2026-10-11). Every published line passes: its timings are its master's."""
    aligned = master.with_suffix(".json")
    if not aligned.is_file():
        return [f"{aligned}: no alignment beside the master, so nothing shows that the lines' token timings are "
                "this take (render_narration.py writes one with every master)"]
    al = json.loads(aligned.read_text(encoding="utf-8"))
    starts = {round(x, 3) for x in al.get("character_start_times_seconds") or []}
    ends = {round(x, 3) for x in al.get("character_end_times_seconds") or []}
    if any(tk["s"] not in starts or tk["e"] not in ends for ln in lines for tk in ln.get("tokens") or []):
        return ["the lines' token timings are not the take at the master (a token starts or ends at a time its "
                "alignment .json does not have): the master was replaced. Run render_narration.py --render with "
                "--only <id> for each line (nothing is sent while the master and its .json are on disk): it gives "
                "the line the new take's audio and its timings together"]
    return []


def other_bytes(published: dict, sha: str, root: Path) -> str:
    """Why a file the manifest already names is not made again from its master: the encode gave
    bytes with sha256 `sha`, not the published ones."""
    return (f"{delivery_path(root, published['url'])}: this published file is missing or damaged on this machine, and "
            f"this ffmpeg writes other bytes for its master (sha256 {sha[:16]}…, published {published['sha256'][:16]}…): "
            "another ffmpeg or LAME build than the one that published it, or a master that is no longer the take the "
            f"file was made from. A published name stands: fetch the file back from the server ({SITE}{published['url']}) "
            "to that path. Only a deliberate re-encode (encode_narration.py --reencode) takes the new bytes, under a "
            "new name that has to be uploaded before the next deploy")


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


def deliver(master: Path, text: str, voice: dict, slug: str, tokens: list[dict], root: Path, *, write: bool = True,
            published: dict | None = None) -> Delivered:
    """Encodes one line's master, checks the result (format, decode, drift, token fit; SystemExit
    on any, and nothing is kept) and, unless `write` is False, puts it at
    <root>/delivery/<voice-slug>/<slug>/<delivery_name>.mp3. Returns the manifest's audio entry for
    it and what was measured. `published` is the audio entry the manifest already has for this
    take, when its delivered file is being made again because it is lost or damaged: the encode
    must then give those very bytes (the same sha256, so the same name), or it is refused and
    nothing is written (other_bytes: another ffmpeg build must not rename a published file)."""
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
        if V.is_cut(tokens, was["ms"]):
            # Not the encode's doing: ElevenLabs returned a take that ends before its own last word
            # (validate_narration.CUT_TOLERANCE_MS; operator 2026-10-17). Never delivered.
            errs.append(f"its master is cut short: the last token ends {V.cut_ms(tokens, was['ms'])} ms after the master "
                        "does (render the line again: render_narration.py refuses a cut take and renders a new one)")
    if errs:
        raise SystemExit(f"delivery of {master} ({V.DELIVERY_FORMAT}) refused: " + "; ".join(errs))
    sha = sha256_bytes(body)
    if published is not None and sha != published["sha256"]:
        raise SystemExit(other_bytes(published, sha, root))
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
    """A delivered file the manifest already names: what is wrong with it ([]: it is the file the
    manifest describes — its sha256, its length, the delivery format — and it decodes)."""
    body = path.read_bytes()
    try:
        info = probe(path)
    except SystemExit as e:  # not audio at all (empty, cut off in its first frame)
        return [str(e)]
    errs = format_problems(info)
    if sha256_bytes(body) != line["audio"]["sha256"]:
        errs.append("its sha256 is not the manifest's")
    if info["ms"] != line["audio"]["ms"]:
        errs.append(f"it is {info['ms']} ms, the manifest says {line['audio']['ms']}")
    bad = decode_error(path)
    if bad:
        errs.append(f"does not decode cleanly: {bad[:200]}")
    return errs


def standing(line: dict, voice: dict, slug: str, root: Path) -> Path | None:
    """The delivered file `line`'s manifest entry already names, when it is on this machine and
    intact (verify_kept); None when the line has none to keep. Such a file is not encoded again
    in passing (the head of this file: a published name stands)."""
    audio = line.get("audio")
    if not V.is_delivery(audio, voice, slug, line["text"]):
        return None
    path = delivery_path(root, audio["url"])
    return path if path.is_file() and not verify_kept(line, path) else None


def settle(lines: list[dict], master: Path, voice: dict, slug: str, root: Path, *,
           reencode: bool = False, write: bool = True) -> tuple[str, Delivered | None, list[str]]:
    """One delivered file: `lines` are the manifest lines that share it (the same text), `master`
    where its master would be. Returns what was done:
      ("kept", None, [])      the manifest's delivered file is on disk and intact: left as it is;
      ("encoded", it, [])     encoded from the master (no valid delivered file, or `reencode`);
      ("absent", None, [])    named by the manifest, but neither it nor its master is on this
                              machine (another one rendered it): nothing to check here;
      ("failed", None, why).
    A file the manifest names that is lost or damaged is made again only as the published bytes
    (deliver's `published`); only `reencode` takes other bytes, under a new name."""
    line = lines[0]
    # One file can only be right for lines that carry ONE set of timings: this step never writes
    # tokens, so a line whose timings are another take's would get this take's audio under them
    # (a retake rendered for one of the lines only). Refused in every case, also when the lines
    # already name one file. With equal timings, the token fit deliver checks below is every line's.
    if any(timings(ln.get("tokens")) != timings(line.get("tokens")) for ln in lines[1:]):
        return "failed", None, [
            "these lines share one text, so one master and one delivered file, but their token timings differ: they are "
            "not all from one take. Run render_narration.py --render with --only <id> for each of them (nothing is sent "
            "while the master and its alignment .json are on disk): it gives each the master's audio and its timings"]
    named = all(V.is_delivery(ln.get("audio"), voice, slug, ln["text"]) and ln["audio"] == line["audio"] for ln in lines)
    kept = delivery_path(root, line["audio"]["url"]) if named else None
    if kept and kept.is_file() and not (reencode and master.exists()):
        errs = verify_kept(line, kept)
        if not errs:
            return "kept", None, []
        if not master.exists():
            return "failed", None, [f"{kept}: {e}" for e in errs]
        # Damaged or cut short, and its master is here: made again below.
    if master.exists():
        # Only this take's timings may go with this take's audio (take_problems): never encoded
        # under tokens of another take, --reencode included.
        problems = take_problems(lines, master)
        if problems:
            return "failed", None, problems
        # A name the manifest already publishes is remade as the published bytes or not at all;
        # only --reencode, or lines that name no file or not one file, take whatever comes out.
        published = line["audio"] if named and not reencode else None
        try:
            return "encoded", deliver(master, line["text"], voice, slug, line.get("tokens") or [], root,
                                      write=write, published=published), []
        except SystemExit as e:
            return "failed", None, [str(e)]
    if not named:
        return "failed", None, [f"no master at {master}, and the manifest does not name a delivered file"]
    return "absent", None, []


def on_disk(files: set[str], root: Path) -> tuple[list[str], list[str]]:
    """`files` (relative to the delivery directory) → (those on this machine, those not), sorted."""
    here = sorted(f for f in files if (root / DELIVERY / f).is_file())
    return here, sorted(files - set(here))


def upload_command(root: Path, listed: Path | None = None) -> str:
    """The upload of the delivered files a --list file names, and of no other file (printed, never
    run; README "Before a deploy"). tar reads the list relative to the delivery directory, so it
    runs there. The archive is unpacked on the VM as the user the media directory belongs to;
    --skip-old-files keeps a file that is already there, which is right because a name never means
    two files, and exits 0 for it (GNU tar 1.35 on the VM; -k would exit 2 on a re-upload).
    COPYFILE_DISABLE and --no-mac-metadata keep macOS's tar from adding ._ files."""
    listed = listed if listed is not None else root / DELIVERY / UPLOAD_LIST
    return (f"cd {shlex.quote(str(root / DELIVERY))} && COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T {shlex.quote(str(listed))} "
            f"| ssh <vm-host> 'sudo -n -u {VM_MEDIA_OWNER} tar -x --skip-old-files -C {VM_MEDIA}/narration'")


def list_command(root: Path) -> str:
    """The run that writes the upload list for `root` (and exits 1 unless every referenced file is
    on this machine as its manifest describes it): the step before upload_command."""
    out = "" if root == DEFAULT_OUT.resolve() else f" --out {shlex.quote(str(root))}"
    return f"python3 encode_narration.py --check{out} --list {shlex.quote(str(root / DELIVERY / UPLOAD_LIST))}"


def upload_steps(root: Path, listed: Path | None = None) -> list[str]:
    """What is left to do before a deploy, as lines to print (README "Before a deploy"; no script
    runs any of it): write the upload list, unless `listed` is the list this run has just written;
    upload the listed files; check each as served."""
    return ([] if listed is not None else [f"  {list_command(root)}"]) + [
        f"  {upload_command(root, listed)}",
        f"then check that each listed file is served with the manifest's sha256 from {SITE}{V.MEDIA_PREFIX}… "
        "(CI cannot see a missing file)."]


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(B.dump(data), encoding="utf-8")
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description="Encode the narration masters to the delivery format (64 kbps mono).")
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 if a manifest or a delivered file would change")
    ap.add_argument("--list", metavar="FILE", help="write the delivered files the manifests reference that are on this "
                    "machine as described, one path per line relative to the delivery directory, for the upload; exit 1 "
                    "if one is not here (a FILE left by an earlier run is removed first)")
    ap.add_argument("--reencode", action="store_true", help="encode every line whose master is here again, also where the "
                    "manifest's delivered file is on disk and intact, and take whatever comes out: published names may "
                    "change. For a deliberate change of ENCODE (a new format) only. NOT for a master replaced by hand: "
                    "this script never touches tokens, so run render_narration.py --render on that line first (it "
                    "re-derives the tokens from the master's .json and delivers the new take)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help=f"output root holding narration/ and delivery/ (default {DEFAULT_OUT})")
    ap.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 2), help="encodes at a time")
    args = ap.parse_args()
    root = Path(args.out).resolve()
    if args.list:
        # A list from an earlier run must not outlive a run that stops before it writes its own
        # (a failed line, no ffmpeg): it would look current to whoever uploads from it.
        Path(args.list).unlink(missing_ok=True)
    print(f"{require_tools()}\nformat {V.DELIVERY_FORMAT}: ffmpeg {' '.join(ENCODE)}")

    manifests, _lessons, _library = V.load_all()
    # One job per file: identical lines of a manifest share theirs.
    jobs: dict[tuple[str, str], tuple[Path, list[dict], list[str]]] = {}
    for name, man in manifests.items():
        voice = man.get("voice")
        for lid, line in man["lines"].items():
            if "audio" not in line:
                continue
            if not voice:
                raise SystemExit(f"{lid}: audio but the manifest names no voice (validate_narration.py)")
            master = master_path(root, voice, name, line["text"])
            job = jobs.setdefault((name, master.name), (master, [], []))
            job[1].append(line)
            job[2].append(lid)
    if not jobs:
        print("no line has audio: nothing to deliver")
        return 0

    def one(job: tuple[str, str]) -> tuple[str, Delivered | None, list[str]]:
        master, lines, lids = jobs[job]
        how, d, errs = settle(lines, master, manifests[job[0]]["voice"], job[0], root, reencode=args.reencode, write=not args.check)
        return how, d, [f"{', '.join(lids)}: {e}" for e in errs]

    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        results = dict(zip(jobs, pool.map(one, jobs)))

    problems = [e for _how, _d, errs in results.values() for e in errs]
    count = {how: sum(1 for h, _d, _e in results.values() if h == how) for how in ("kept", "encoded", "absent", "failed")}
    changed: dict[str, int] = {}
    files: set[str] = set()  # relative to the delivery directory
    done: list[tuple[str, Delivered]] = []  # encoded in this run
    sizes: list[tuple[str, int, int, str]] = []  # (line, master bytes, delivered bytes, file) where both are known
    for (name, file), (how, d, _errs) in results.items():
        master, lines, lids = jobs[(name, file)]
        files.add((d.audio if d else lines[0]["audio"])["url"][len(V.MEDIA_PREFIX):])
        if how == "kept" and master.exists():
            path = delivery_path(root, lines[0]["audio"]["url"])
            sizes.append((lids[0], master.stat().st_size, path.stat().st_size, path.name))
        if d is None:
            continue
        done.append((lids[0], d))
        sizes.append((lids[0], d.master_size, d.size, d.path.name))
        for lid in lids:
            if manifests[name]["lines"][lid]["audio"] != d.audio:
                changed[name] = changed.get(name, 0) + 1
                manifests[name]["lines"][lid]["audio"] = dict(d.audio)

    did = [f"{count['kept']} kept (on disk as the manifest describes them: sha256, length, format, decode)" if count["kept"] else "",
           f"{count['encoded']} encoded from their masters" if count["encoded"] else "",
           f"{count['absent']} with neither master nor delivered file on this machine (NOT checked)" if count["absent"] else "",
           f"{count['failed']} failed" if count["failed"] else ""]
    print(f"\n{sum(len(lids) for _m, _l, lids in jobs.values())} lines with audio, {len(jobs)} files: " + ", ".join(d for d in did if d))
    if sizes:
        before, after = sum(m for _l, m, _d, _f in sizes), sum(d for _l, _m, d, _f in sizes)
        big = max(sizes, key=lambda x: x[1])
        print(f"bytes: {before:,} (masters, {V.OUTPUT_FORMAT}) → {after:,} ({V.DELIVERY_FORMAT}), {after / before:.1%}"
              + (f" (the {len(sizes)} files whose master is here)" if len(sizes) != len(jobs) else ""))
        print(f"largest: {big[0]} {big[1]:,} → {big[2]:,} bytes ({big[3]})")
    if done:
        worst = max(done, key=lambda x: abs(x[1].drift_ms))
        print(f"length drift, delivered − master: max {abs(worst[1].drift_ms):.3f} ms ({worst[0]}); limit {MAX_DRIFT_MS} ms")
        print(f"{len(done)} of {len(done)} encoded decode cleanly, are {V.DELIVERY_FORMAT} by ffprobe, and hold their tokens as the master does")
        for lid, d in done:
            if d.past_master_ms:
                print(f"  note: {lid}: its last token already ends {d.past_master_ms} ms after its MASTER does "
                      "(ElevenLabs' alignment, not the encode; unchanged)")
    if problems:
        print(f"\nFAIL: {len(problems)} problem(s); no manifest written")
        for e in problems:
            print("  -", e)
        return 1
    stale = sorted(str(p.relative_to(root / DELIVERY)) for p in (root / DELIVERY).glob("*/*/*.mp3")
                   if str(p.relative_to(root / DELIVERY)) not in files) if (root / DELIVERY).exists() else []
    if stale:
        print(f"{len(stale)} files under {root / DELIVERY} are no longer referenced by a manifest (older texts or "
              "takes); they are not listed for the upload")
    out_of_date = False
    unfit: set[str] = set()  # --check: referenced files that are not on disk as encoded (damaged, absent, or a new name)
    if args.check:
        missing = [(lid, d) for lid, d in done if not d.path.exists() or sha256_bytes(d.path.read_bytes()) != d.audio["sha256"]]
        unfit = {d.audio["url"][len(V.MEDIA_PREFIX):] for _lid, d in missing}
        if changed or missing:
            out_of_date = True
            print("\nout of date: " + ", ".join([f"{n} ({c} lines)" for n, c in changed.items()]
                                                + ([f"{len(missing)} delivered files not on disk as encoded"] if missing else []))
                  + "; run encode_narration.py" + (" --reencode" if args.reencode else ""))
    else:
        for name, n in changed.items():
            dest = V.NARRATION_DIR / f"{name}.json"
            write_json(dest, manifests[name])
            print(f"{name}: {n} lines now name their delivered file -> "
                  f"{dest.relative_to(BELAJAR.parent) if dest.is_relative_to(BELAJAR.parent) else dest}")
        if not changed:
            print("the manifests already describe these files")
    # The upload list: only what is on this machine as the manifests describe it, and a referenced
    # file that is not fails the run — an upload from this list would leave that line without its
    # audio (a 404, caption-only). Under --check nothing was repaired, so a file found damaged
    # (`unfit`) is still on disk as it was: it is left out too, never listed for an upload.
    gone: list[str] = []
    if args.list:
        here, gone = on_disk(files - unfit, root)
        gone = sorted(set(gone) | unfit)
        Path(args.list).parent.mkdir(parents=True, exist_ok=True)
        Path(args.list).write_text("".join(f"{f}\n" for f in here), encoding="utf-8")
        print(f"listed {len(here)} of {len(files)} referenced files in {args.list}")
        if gone:
            print(f"\nFAIL: {len(gone)} referenced file(s) are not under {root / DELIVERY} as the manifests describe them "
                  "(absent, or damaged) and are NOT in the list; "
                  "unless the server already has them, their lines would play caption-only:")
            for f in gone[:20]:
                print("  -", f)
            if len(gone) > 20:
                print(f"  … and {len(gone) - 20} more")
    if out_of_date or gone:
        return 1
    if args.check:
        ok = [f"{count['kept']} delivered files are on disk as the manifests describe them" if count["kept"] else "",
              f"{count['encoded']} encoded again from their masters, equal to the manifests and to the files on disk" if count["encoded"] else "",
              f"{count['absent']} are not on this machine and were NOT checked" if count["absent"] else ""]
        print("\nOK: " + "; ".join(o for o in ok if o))
    else:
        print(f"\ndelivery directory: {root / DELIVERY}")
        if count["absent"]:
            print(f"{count['absent']} referenced files are not on this machine (neither master nor delivered file) and were NOT checked")
    # The upload is printed, never run, and it sends the listed files only: not the directory,
    # which also holds the files no manifest references any more.
    if args.list:
        print(f"Next, before the deploy (README, \"Before a deploy\"; not run by this script): upload the {len(files)} listed files,")
        print("\n".join(upload_steps(root, Path(args.list).resolve())))
    elif not args.check:
        print("Next: python3 build_narration.py --check && python3 validate_narration.py; then, before the deploy (README, "
              "\"Before a deploy\"; not run by this script):")
        print("\n".join(upload_steps(root)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
