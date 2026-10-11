#!/usr/bin/env python3
"""Stage 0/1: download every input listed in sources.json into cache/ and pin its sha256.

    python3 fetch.py               # download what is missing; verify everything against the pins
    python3 fetch.py --refresh     # re-download everything and compare with the pins (upstream drift check)
    python3 fetch.py --repin ID    # accept new bytes for input ID (deliberate pin update)

First run: pins are empty, so the downloaded bytes are pinned. Later runs fail loudly
(exit 1) if a cached or re-downloaded file differs from its pin. Per-surah inputs (the QuranEnc
sura files and the EveryAyah duration probes) follow common.SURAHS, so a newly registered surah
is downloaded and pinned on the next run while the existing pins are only verified. Stdlib only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import terms as TM
from common import PIPELINE, SURAHS, load_sources, load_tanzil, mp3_duration_ms, save_sources, sha256_bytes

UA = "dakwah-lens-belajar-pipeline/0.1 (+https://dakwah-lens.id)"
TODAY = dt.date.today().isoformat()
problems: list[str] = []


def http_get(url: str) -> bytes:
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - report and retry
            last = e
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"download failed: {url}: {last}")


def obtain(path: Path, url: str, refresh: bool) -> bytes:
    if path.exists() and not refresh:
        return path.read_bytes()
    print(f"  GET {url}")
    b = http_get(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b)
    return b


def pin(meta: dict, key: str, b: bytes, input_id: str, repin: set[str], sha_field: str = "sha256") -> None:
    got = sha256_bytes(b)
    old = meta.get(sha_field)
    if old is None or input_id in repin:
        if old and old != got:
            print(f"  [{input_id}] {sha_field} re-pinned: {old} -> {got}")
        meta[sha_field] = got
        return
    if old != got:
        problems.append(f"[{input_id}] {key}: sha256 {got} does not match pin {old}")
    else:
        print(f"  [{input_id}] {key}: sha256 OK {got[:16]}…")


def fetch_tanzil(meta: dict, refresh: bool, repin: set[str]) -> None:
    p = PIPELINE / meta["cache_path"]
    b = obtain(p, meta["url"], refresh)
    text = b.decode("utf-8")
    if "Tanzil Quran Text (Uthmani, Version 1.1)" not in text:
        problems.append("[tanzil_uthmani] footer does not name 'Tanzil Quran Text (Uthmani, Version 1.1)'")
    if "CHANGING IT IS NOT ALLOWED" not in text:
        problems.append("[tanzil_uthmani] licence footer missing")
    # The download options we chose must be reflected in the bytes.
    # Tatweel itself still occurs as the carrier of a hamza or small yeh (part of the text);
    # the unticked option only removes tatweel placed before a superscript alef.
    checks = [("\u0640\u0670", "tatweel before superscript alef"), ("\u06E9", "sajdah sign"),
              ("\u06DE", "rub-el-hizb sign")] + [(chr(c), "pause mark") for c in range(0x06D6, 0x06DC)]
    for ch, label in checks:
        if ch in text:
            codes = " ".join(f"U+{ord(x):04X}" for x in ch)
            problems.append(f"[tanzil_uthmani] unexpected {label} ({codes}) in download")
    lines = [ln for ln in text.split("\n") if ln and not ln.startswith("#")]
    if len(lines) != 6236:
        problems.append(f"[tanzil_uthmani] expected 6236 verse lines, got {len(lines)}")
    pin(meta, "file", b, "tanzil_uthmani", repin)
    meta["bytes"] = len(b)
    meta["retrieved"] = meta.get("retrieved") or TODAY


def fetch_tanzil_metadata(meta: dict, refresh: bool, repin: set[str]) -> None:
    p = PIPELINE / meta["cache_path"]
    b = obtain(p, meta["url"], refresh)
    text = b.decode("utf-8")
    if 'license="cc-by"' not in text or '<sura index="114"' not in text:
        problems.append("[tanzil_metadata] unexpected file (no cc-by licence attribute or no sura 114)")
    pin(meta, "file", b, "tanzil_metadata", repin)
    meta["bytes"] = len(b)
    meta["retrieved"] = meta.get("retrieved") or TODAY


def fetch_qac(meta: dict, refresh: bool, repin: set[str]) -> None:
    p = PIPELINE / meta["cache_path"]
    b = obtain(p, meta["url"], refresh)
    head = b[:3000].decode("utf-8", "replace")
    if "Quranic Arabic Corpus (morphology, version 0.4)" not in head:
        problems.append("[qac_morphology] header does not name 'morphology, version 0.4'")
    pin(meta, "file", b, "qac_morphology", repin)
    meta["bytes"] = len(b)
    meta["retrieved"] = meta.get("retrieved") or TODAY


def fetch_quran_align(meta: dict, refresh: bool, repin: set[str]) -> None:
    p = PIPELINE / meta["cache_path"]
    b = obtain(p, meta["url"], refresh)
    pin(meta, "zip", b, "quran_align", repin)
    meta["bytes"] = len(b)
    meta["retrieved"] = meta.get("retrieved") or TODAY
    z = zipfile.ZipFile(io.BytesIO(b))
    readme = z.read("README").decode("utf-8")
    for name, m in meta["members"].items():
        data = z.read(name)
        sha1 = hashlib.sha1(data).hexdigest()
        if sha1 != m["readme_sha1"]:
            problems.append(f"[quran_align] {name}: sha1 {sha1} != README/pin {m['readme_sha1']}")
        if m["readme_sha1"] not in readme:
            problems.append(f"[quran_align] {name}: pinned sha1 not present in the release README")
        out = p.parent / name
        out.write_bytes(data)
        pin(m, name, data, "quran_align", repin)
    lic = z.read("LICENSE").decode("utf-8", "replace")
    if "Attribution 4.0 International" not in lic:
        problems.append("[quran_align] LICENSE is not CC BY 4.0")


QURANENC_SURA_URL = "https://quranenc.com/api/v1/translation/sura/indonesian_affairs/{n}"


def check_quranenc_rows(b: bytes, n: int, n_ayat: int) -> None:
    rows = json.loads(b)["result"]
    if [int(r["aya"]) for r in rows] != list(range(1, n_ayat + 1)):
        problems.append(f"[quranenc] sura {n} does not have ayat 1..{n_ayat}")
    if any(int(r["sura"]) != n for r in rows):
        problems.append(f"[quranenc] sura {n}: a row names another sura")


def fetch_quranenc(meta: dict, refresh: bool, repin: set[str]) -> None:
    p = PIPELINE / meta["cache_path"]
    b = obtain(p, meta["url"], refresh)
    pin(meta, "sura", b, "quranenc_indonesian_affairs", repin)
    meta["bytes"] = len(b)
    rows = json.loads(b)["result"]
    if [int(r["aya"]) for r in rows] != list(range(1, 8)):
        problems.append("[quranenc] sura 1 does not have ayat 1..7")
    # Every other surah with a lesson: same endpoint and recording, one pinned file per sura.
    suras = meta.setdefault("suras", {})
    for spec in SURAHS:
        if spec.surah == 1:
            continue
        n = spec.surah
        sm = suras.setdefault(str(n), {"url": QURANENC_SURA_URL.format(n=n),
                                       "cache_path": f"cache/quranenc/indonesian_affairs_sura{n}.json",
                                       "sha256": None})
        sb = obtain(PIPELINE / sm["cache_path"], sm["url"], refresh)
        pin(sm, f"sura {n}", sb, "quranenc_indonesian_affairs", repin)
        sm["bytes"] = len(sb)
        sm["retrieved"] = sm.get("retrieved") or TODAY
        check_quranenc_rows(sb, n, spec.n_ayat)
    pv = PIPELINE / meta["version_cache_path"]
    vb = obtain(pv, meta["version_url"], refresh)
    pin(meta, "translations list", vb, "quranenc_indonesian_affairs", repin, "version_sha256")
    entry = next((t for t in json.loads(vb)["translations"] if t["key"] == "indonesian_affairs"), None)
    if not entry:
        problems.append("[quranenc] indonesian_affairs missing from the translations list")
        return
    for field_name, value in [("version", entry["version"]), ("title_id", entry["title"]),
                              ("last_update_unix", entry["last_update"])]:
        if meta.get(field_name) not in (None, value) and "quranenc_indonesian_affairs" not in repin:
            problems.append(f"[quranenc] {field_name} changed upstream: {meta[field_name]!r} -> {value!r}")
        else:
            meta[field_name] = value
    meta["retrieved"] = meta.get("retrieved") or TODAY


def fetch_quranenc_waris(meta: dict, sura1: dict, tanzil: dict, refresh: bool, repin: set[str]) -> None:
    """Ilmu Waris dalil (plan §9.2): the same QuranEnc endpoint and translation as sura 1 above, for
    the suras that hold the inheritance ayat and the plan §8 gap ayat. The sura endpoint reports no
    version, so the version is the one fetch_quranenc() read from the pinned translations list."""
    key = "quranenc_indonesian_affairs_waris"
    counts: dict[int, int] = {}
    for (s, _a) in load_tanzil(PIPELINE / tanzil["cache_path"]).verses:
        counts[s] = counts.get(s, 0) + 1
    d = PIPELINE / meta["cache_dir"]
    for sura in meta["suras"]:
        name = f"indonesian_affairs_sura{sura}.json"
        url = meta["url_pattern"].replace("{SURA}", str(sura))
        b = obtain(d / name, url, refresh)
        f = meta["files"].setdefault(name, {"url": url, "sha256": None})
        if f["url"] != url:
            problems.append(f"[{key}] {name}: pinned url {f['url']} != {url}")
        pin(f, name, b, key, repin)
        f["bytes"] = len(b)
        rows = json.loads(b)["result"]
        if {int(r["sura"]) for r in rows} != {sura}:
            problems.append(f"[{key}] {name}: rows are not all sura {sura}")
        if [int(r["aya"]) for r in rows] != list(range(1, counts[sura] + 1)):
            problems.append(f"[{key}] {name}: ayat are not 1..{counts[sura]} (the Tanzil count)")
        f["ayat"] = len(rows)
        f["retrieved"] = f.get("retrieved") or TODAY
    if meta.get("version") != sura1.get("version") or meta.get("title_id") != sura1.get("title_id"):
        problems.append(f"[{key}] version/title {meta.get('version')!r}/{meta.get('title_id')!r} differ from the "
                        f"translations list as read for sura 1: {sura1.get('version')!r}/{sura1.get('title_id')!r}")


def fetch_fawaz_muslim(meta: dict, refresh: bool, repin: set[str]) -> None:
    """Ilmu Waris dalil: fawazahmed0 Sahih Muslim sections, used only to map api/data/muslim.json's
    sequential numbers to Fuad Abd al-Baqi numbers (build_dalil.muslim_canon)."""
    key = "fawazahmed0_muslim_sections"
    d = PIPELINE / meta["cache_dir"]
    for n in meta["sections"]:
        name = f"ara-muslim-sections-{n}.json"
        url = meta["url_pattern"].replace("{N}", str(n))
        b = obtain(d / name, url, refresh)
        f = meta["files"].setdefault(name, {"url": url, "sha256": None})
        if f["url"] != url:
            problems.append(f"[{key}] {name}: pinned url {f['url']} != {url}")
        pin(f, name, b, key, repin)
        f["bytes"] = len(b)
        data = json.loads(b)
        md = data["metadata"]
        if md.get("name") != "Sahih Muslim" or list(md.get("section", {})) != [str(n)]:
            problems.append(f"[{key}] {name}: metadata is not Sahih Muslim section {n}")
            continue
        det = md["section_detail"][str(n)]
        nums = [h["hadithnumber"] for h in data["hadiths"]]
        if nums != list(range(det["hadithnumber_first"], det["hadithnumber_last"] + 1)):
            problems.append(f"[{key}] {name}: hadithnumber is not the contiguous range the metadata states")
        f["section_title_en"] = md["section"][str(n)]
        f["hadithnumber_range"] = [det["hadithnumber_first"], det["hadithnumber_last"]]
        f["retrieved"] = f.get("retrieved") or TODAY


def fetch_shamela_istilah(meta: dict, refresh: bool, repin: set[str]) -> None:
    """Konsep grammar terms in Arabic script (operator 2026-10-10; terms.py): the Shamela pages whose
    text attests each spelling in authored/library.terms.json. The HTML carries per-request tokens,
    so the EXTRACTED page text (terms.extract_shamela) is what is cached and pinned (`text_sha256`).
    A page is added by listing its "book/id" key in `pages`; the print page and page title are
    recorded on the first run and must not change after that (a moved page breaks its citations)."""
    key = "shamela_istilah"
    d = PIPELINE / meta["cache_dir"]
    for pk, pm in meta["pages"].items():
        book, page = pk.split("/")
        if str(pm.get("book")) != book or book not in meta["books"]:
            problems.append(f"[{key}] {pk}: book {pm.get('book')!r} is not a listed kitab")
            continue
        url = meta["url_pattern"].replace("{BOOK}", book).replace("{PAGE}", page)
        if pm.get("url") != url:
            problems.append(f"[{key}] {pk}: pinned url {pm.get('url')} != {url}")
        p = d / book / f"{page}.txt"
        if p.exists() and not refresh:
            b = p.read_bytes()
        else:
            print(f"  GET {url}")
            try:
                e = TM.extract_shamela(http_get(url).decode("utf-8"))
            except ValueError as err:
                problems.append(f"[{key}] {pk}: {err}")
                continue
            for field_name in ("print_page", "title"):
                if pm.get(field_name) not in (None, e[field_name]) and key not in repin:
                    problems.append(f"[{key}] {pk}: {field_name} changed upstream: {pm[field_name]!r} -> {e[field_name]!r}")
                else:
                    pm[field_name] = e[field_name]
            b = e["text"].encode("utf-8")
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b)
            time.sleep(0.3)  # one page at a time, politely
        pin(pm, pk, b, key, repin, "text_sha256")
        pm["chars"] = len(b.decode("utf-8"))
        pm["retrieved"] = pm.get("retrieved") or TODAY


def fetch_everyayah(input_id: str, meta: dict, refresh: bool, repin: set[str]) -> None:
    d = PIPELINE / meta["cache_dir"]
    for spec in SURAHS:
        for ayah in range(1, spec.n_ayat + 1):
            fetch_everyayah_file(input_id, meta, d, spec.surah, ayah, refresh, repin)


def fetch_everyayah_file(input_id: str, meta: dict, d: Path, surah: int, ayah: int, refresh: bool,
                         repin: set[str]) -> None:
    name = f"{surah:03d}{ayah:03d}.mp3"
    url = meta["url_pattern"].replace("{SSS}", f"{surah:03d}").replace("{AAA}", f"{ayah:03d}")
    b = obtain(d / name, url, refresh)
    f = meta["files"].setdefault(name, {"url": url, "sha256": None})
    if f["url"] != url:
        problems.append(f"[{input_id}] {name}: pinned url {f['url']} != {url}")
    pin(f, name, b, input_id, repin)
    f["bytes"] = len(b)
    f.update(mp3_duration_ms(b))
    f["retrieved"] = f.get("retrieved") or TODAY


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download and compare against the pins")
    ap.add_argument("--repin", action="append", default=[], help="accept new bytes for this input id")
    ap.add_argument("--skip-audio", action="store_true", help="skip the EveryAyah duration probes")
    ap.add_argument("--skip-waris", action="store_true", help="skip the Ilmu Waris inputs (QuranEnc suras > 1, Muslim map)")
    args = ap.parse_args()
    repin = set(args.repin)
    src = load_sources()
    I = src["inputs"]
    print("tanzil_uthmani"); fetch_tanzil(I["tanzil_uthmani"], args.refresh, repin)
    print("tanzil_metadata"); fetch_tanzil_metadata(I["tanzil_metadata"], args.refresh, repin)
    print("qac_morphology"); fetch_qac(I["qac_morphology"], args.refresh, repin)
    print("quran_align"); fetch_quran_align(I["quran_align"], args.refresh, repin)
    print("quranenc_indonesian_affairs"); fetch_quranenc(I["quranenc_indonesian_affairs"], args.refresh, repin)
    if not args.skip_waris:
        print("quranenc_indonesian_affairs_waris")
        fetch_quranenc_waris(I["quranenc_indonesian_affairs_waris"], I["quranenc_indonesian_affairs"],
                             I["tanzil_uthmani"], args.refresh, repin)
        print("fawazahmed0_muslim_sections"); fetch_fawaz_muslim(I["fawazahmed0_muslim_sections"], args.refresh, repin)
    print("shamela_istilah"); fetch_shamela_istilah(I["shamela_istilah"], args.refresh, repin)
    if not args.skip_audio:
        for k in ("everyayah_husary_muallim", "everyayah_alafasy"):
            print(k); fetch_everyayah(k, I[k], args.refresh, repin)
    if problems:
        print("\nFETCH FAILED:", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        return 1
    save_sources(src)
    print("\nOK: all inputs present and matching their pins; sources.json updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
