#!/usr/bin/env python3
"""Build belajar/content/al-fatihah.json: `python3 build_fatihah.py` = `python3 build_surah.py al-fatihah`.

Kept as the entry point named in al-fatihah.json's data_versions.pipeline ("build_fatihah.py +
facts.py"); the build itself lives in build_surah.py and reproduces the file byte for byte.
"""
from __future__ import annotations

import sys

import build_surah
from build_surah import errors, pos_label, warnings  # noqa: F401  (older imports keep working)

if __name__ == "__main__":
    sys.exit(build_surah.main(["al-fatihah"]))
