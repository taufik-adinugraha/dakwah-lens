#!/usr/bin/env python3
"""Our copies of the recordings we did not make (operator 2026-10-15: "they will allow us to copy and
distribute for educational non-profit purposes; we copy to our server so latency is minimum").

Two sets, each copied UNALTERED (byte for byte, sha256 = the upstream file's: no re-encode, no
trim — a word is played as [start, end] of its file, as the imam's clips always were):

  alafasy    Mishary Rashid Alafasy's recitation of an ayah, from EveryAyah
             (https://everyayah.com/data/Alafasy_128kbps/<SSS><AAA>.mp3)
             → /belajar/media/narration/alafasy/<SSS><AAA>.mp3
             every ayah a lesson recites, and every ayah a Konsep / composition example clip is
             cut from (the quran-align word timings stay: they time the same file).
  quran-com  Quran.com's word-by-word recording of a word (content/wordvoice.json, wordvoice.py)
             (https://audio.qurancdn.com/wbw/<SSS>_<AAA>_<WWW>.mp3)
             → /belajar/media/narration/quran-com/wbw/<SSS>_<AAA>_<WWW>.mp3

Both live under /belajar/media/narration/, which Caddy already serves from
/srv/dakwah-lens/data/belajar-media/narration with `Cache-Control: public, max-age=31536000,
immutable` (deploy/Caddyfile, `@narration`): a new subdirectory needs no configuration. Because
of `immutable`, a file is never REPLACED under its name: should upstream change a file, the copy
gets a new name (the pin below would fail first).

NOT copied: the fact cards' ayah popup (src/lib/ayah.ts recitationUrl: any of 1,629 ayat,
content/ayat/locations.json) still streams from EveryAyah — measured 2026-10-15 on a sample of 40,
those files average 342 KB, about 556 MB for the set, past the operator's 60 MB line ("if the
imam set is > 60 MB, stop and report before wiring").

  host_media.py --fetch                  download every referenced file not on this machine (read-only;
                                         a lesson ayah is taken from fetch.py's pinned cache when it is
                                         there), measure it, write pipeline/hosted.json (the Alafasy pins)
  host_media.py --check [--no-network]   every hosted URL the content references has its pin and a
                                         well-formed name; a lesson ayah's pin is sources.json's; locally
                                         also every copy on this machine against its pin. --no-network (CI):
                                         the content and the pins only
  host_media.py --deliver [--out DIR]    copy every file into DIR/delivery/<alafasy|quran-com/wbw>/, byte
                                         for byte, check each against its pin, and write
                                         DIR/delivery/files-hosted.txt (the upload list; printed command)

Upload (the operator's step; this script never writes to the server):
  cd <out>/delivery && COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T files-hosted.txt | ssh <vm-host> \\
     'sudo -n -u deploy tar -x --skip-old-files -C /srv/dakwah-lens/data/belajar-media/narration'
then every listed file is fetched from https://dakwah-lens.id/belajar/media/narration/… and its sha256
compared with the local copy (README "Before a deploy", step 4, with files-hosted.txt).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

import wordvoice as W

PIPELINE = Path(__file__).resolve().parent
BELAJAR = PIPELINE.parent
CONTENT = BELAJAR / "content"
PINS = PIPELINE / "hosted.json"
NARRATION_PREFIX = "/belajar/media/narration/"
ALAFASY_PREFIX = NARRATION_PREFIX + "alafasy/"
ALAFASY_UPSTREAM = "https://everyayah.com/data/Alafasy_128kbps/"
ALAFASY_FILE = re.compile(r"(\d{3})(\d{3})\.mp3")
UPSTREAM = PIPELINE / "out" / "upstream"
ALAFASY_CACHE = UPSTREAM / "everyayah" / "Alafasy_128kbps"
FETCH_CACHE = PIPELINE / "cache" / "everyayah" / "Alafasy_128kbps"  # fetch.py's pinned lesson ayat
DEFAULT_OUT = PIPELINE / "out"
LIST = "files-hosted.txt"
_REF = re.compile(r"/belajar/media/narration/(alafasy/\d{6}\.mp3|quran-com/wbw/\d{3}_\d{3}_\d{3}\.mp3)")
_ANY_OURS = re.compile(r"/belajar/media/narration/(alafasy|quran-com)/[^\"\s]*")


def alafasy_url(s: int, a: int) -> str:
    """Our copy of the imam's file of one ayah (what the lessons' Recitation.url and every example
    clip carry since 2026-10-15)."""
    return f"{ALAFASY_PREFIX}{s:03d}{a:03d}.mp3"


def alafasy_upstream(s: int, a: int) -> str:
    return f"{ALAFASY_UPSTREAM}{s:03d}{a:03d}.mp3"


def content_texts(content: Path = CONTENT) -> dict[str, str]:
    """Every content file the app reads, as text (the lessons, the library, the compositions, the
    word voices; the narration manifests carry no recording of these sets)."""
    files = sorted(content.glob("*.json")) + sorted((content / "compose").glob("*.json"))
    return {f.relative_to(content).as_posix(): f.read_text(encoding="utf-8") for f in files}


def referenced(content: Path = CONTENT) -> tuple[set[str], list[str]]:
    """({path under narration/ of every hosted file the content references}, [malformed refs])."""
    refs: set[str] = set()
    bad: list[str] = []
    for name, text in content_texts(content).items():
        for m in _ANY_OURS.finditer(text):
            if m.group(0).endswith("/"):
                continue  # a prefix (wordvoice.json `quran_com.prefix`), not a file
            r = _REF.fullmatch(m.group(0))
            if r:
                refs.add(r.group(1))
            else:
                bad.append(f"content/{name}: {m.group(0)!r} is not a hosted file name")
    return refs, bad


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def duration_ms(p: Path) -> int:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       check=True, capture_output=True, text=True)
    return round(float(r.stdout.strip()) * 1000)


def load_pins() -> dict:
    return json.loads(PINS.read_text(encoding="utf-8")) if PINS.exists() else {"alafasy": {}}


def sources_pins() -> dict:
    inputs = json.loads((PIPELINE / "sources.json").read_text(encoding="utf-8")).get("inputs") or {}
    return (inputs.get("everyayah_alafasy") or {}).get("files") or {}


def pin_of(rel: str, pins: dict, manifest: dict | None) -> dict | None:
    """{upstream, sha256} (+ bytes, ms) of a hosted file: hosted.json for the imam's, the word-voice
    manifest for Quran.com's."""
    if rel.startswith("alafasy/"):
        return (pins.get("alafasy") or {}).get(rel.split("/", 1)[1])
    for e in ((manifest or {}).get("words") or {}).values():
        a = e.get("audio") or {}
        if e.get("source") == "quran.com" and a.get("url") == NARRATION_PREFIX + rel:
            return {"upstream": a["upstream"], "sha256": a["sha256"], "ms": a["ms"]}
    return None


def local_copy(rel: str) -> Path | None:
    """Where this machine holds the upstream bytes of `rel`, if anywhere."""
    if rel.startswith("alafasy/"):
        name = rel.split("/", 1)[1]
        for d in (ALAFASY_CACHE, FETCH_CACHE):
            if (d / name).exists():
                return d / name
        return None
    p = UPSTREAM / rel
    return p if p.exists() else None


def problems(pins: dict, manifest: dict | None, content: Path = CONTENT, local: bool = True) -> list[str]:
    refs, out = referenced(content)
    ala = pins.get("alafasy") or {}
    src = sources_pins()
    for rel in sorted(refs):
        p = pin_of(rel, pins, manifest)
        if p is None:
            out.append(f"{rel}: referenced by the content, but no pin (host_media.py --fetch)")
            continue
        if rel.startswith("alafasy/"):
            name = rel.split("/", 1)[1]
            m = ALAFASY_FILE.fullmatch(name)
            if set(p) != {"upstream", "sha256", "bytes", "ms"}:
                out.append(f"{rel}: pin keys {sorted(p)} (expected bytes, ms, sha256, upstream)")
                continue
            if p["upstream"] != alafasy_upstream(int(m.group(1)), int(m.group(2))):
                out.append(f"{rel}: upstream {p['upstream']} is not EveryAyah's Alafasy file of the same ayah")
            if name in src and src[name].get("sha256") != p["sha256"]:
                out.append(f"{rel}: pin {p['sha256'][:12]}… is not sources.json's {src[name]['sha256'][:12]}… (fetch.py pins the lesson ayat)")
        if not re.fullmatch(r"[0-9a-f]{64}", str(p.get("sha256"))):
            out.append(f"{rel}: sha256 is not 64 hex digits")
        if local:
            f = local_copy(rel)
            if f is not None and sha256(f) != p["sha256"]:
                out.append(f"{rel}: the copy {f} is not its pin (a stale pin, or upstream changed the file)")
    for name in sorted(set(ala) - {r.split("/", 1)[1] for r in refs if r.startswith("alafasy/")}):
        out.append(f"alafasy/{name}: pinned in hosted.json, but no content references it any more")
    return out


def delivery_problems(out_dir: Path, pins: dict, manifest: dict | None, content: Path = CONTENT) -> list[str]:
    """Every hosted file the content references is in out_dir/delivery with its pin's sha256."""
    refs, errs = referenced(content)
    for rel in sorted(refs):
        p = pin_of(rel, pins, manifest)
        f = out_dir / "delivery" / rel
        if p is None:
            errs.append(f"{rel}: no pin")
        elif not f.exists():
            errs.append(f"{rel}: not in {out_dir / 'delivery'} (host_media.py --deliver)")
        elif sha256(f) != p["sha256"]:
            errs.append(f"{rel}: the delivered file is not its pin (it must be the upstream file, unaltered)")
    return errs


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "dakwah-lens-belajar-pipeline/1 (read-only)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fetch(manifest: dict | None) -> dict:
    refs, bad = referenced()
    if bad:
        raise SystemExit("\n".join(bad))
    pins = load_pins()
    ala = dict(pins.get("alafasy") or {})
    ALAFASY_CACHE.mkdir(parents=True, exist_ok=True)
    for rel in sorted(refs):
        if not rel.startswith("alafasy/"):
            continue
        name = rel.split("/", 1)[1]
        m = ALAFASY_FILE.fullmatch(name)
        f = local_copy(rel)
        if f is None:
            f = ALAFASY_CACHE / name
            f.write_bytes(get(alafasy_upstream(int(m.group(1)), int(m.group(2)))))
            print(f"  downloaded {name}")
        ala[name] = {"upstream": alafasy_upstream(int(m.group(1)), int(m.group(2))), "sha256": sha256(f),
                     "bytes": f.stat().st_size, "ms": duration_ms(f)}
    keep = {r.split("/", 1)[1] for r in refs if r.startswith("alafasy/")}
    return {
        "_comment": "Written by pipeline/host_media.py --fetch: the pins of our unaltered copies of Mishary Rashid Alafasy's recitation (EveryAyah), one per ayah the content plays. Quran.com's word files are pinned in content/wordvoice.json. Never edited by hand.",
        "alafasy": {k: ala[k] for k in sorted(ala) if k in keep},
    }


def deliver(out_dir: Path, pins: dict, manifest: dict | None) -> list[str]:
    refs, _ = referenced()
    d = out_dir / "delivery"
    listed = []
    for rel in sorted(refs):
        src = local_copy(rel)
        if src is None:
            raise SystemExit(f"{rel}: not on this machine (host_media.py --fetch, build_wordvoice.py --fetch-quran-com)")
        dst = d / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or sha256(dst) != sha256(src):
            shutil.copyfile(src, dst)
        listed.append(rel)
    errs = delivery_problems(out_dir, pins, manifest)
    if not errs:
        (d / LIST).write_text("\n".join(listed) + "\n", encoding="utf-8")
    return errs


def sizes(pins: dict, manifest: dict | None) -> str:
    refs, _ = referenced()
    by: dict[str, list[int]] = {"alafasy": [], "quran-com": []}
    for rel in refs:
        f = local_copy(rel)
        by[rel.split("/", 1)[0]].append(f.stat().st_size if f else (pin_of(rel, pins, manifest) or {}).get("bytes", 0))
    return ", ".join(f"{k}: {len(v)} files, {sum(v) / 1e6:.2f} MB" for k, v in by.items())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--no-network", action="store_true", help="with --check (CI): the content and the pins only")
    ap.add_argument("--deliver", action="store_true")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    a = ap.parse_args()
    manifest = W.load_manifest()
    if a.fetch:
        pins = fetch(manifest)
        PINS.write_text(json.dumps(pins, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {PINS.relative_to(BELAJAR.parent)}: {sizes(pins, manifest)}")
        return 0
    pins = load_pins()
    if a.deliver:
        errs = deliver(Path(a.out), pins, manifest)
        if errs:
            print("delivery problems:\n  " + "\n  ".join(errs))
            return 1
        d = Path(a.out) / "delivery"
        n = len((d / LIST).read_text(encoding="utf-8").split())
        print(f"{n} files in {d}, each its upstream file byte for byte ({sizes(pins, manifest)}); upload list {d / LIST}")
        print(f"upload (not run): cd {d} && COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T {LIST} | ssh <vm-host> "
              "'sudo -n -u deploy tar -x --skip-old-files -C /srv/dakwah-lens/data/belajar-media/narration'")
        return 0
    errs = problems(pins, manifest, local=not a.no_network)
    if errs:
        print("hosted media problems:\n  " + "\n  ".join(errs[:40]))
        return 1
    refs, _ = referenced()
    print(f"hosted media: {len(refs)} files referenced, every one pinned ({sizes(pins, manifest)})"
          + (" [no network: content and pins only]" if a.no_network else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
