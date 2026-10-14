"""Quality screening of a recorded word (local only: needs numpy and ffmpeg, not in CI).

eleven_multilingual_v2 sometimes makes up a sound after a short word: "ihdi" came back "ihdis"
(operator 2026-10-14), a burst of high-frequency noise right after the last vowel. The screen is
on the DELIVERY file, where levelling has made the burst as loud as it will be heard: some of the
last frames are within 18 dB of the loudest frame and have most of their energy above 4.5 kHz,
which a vowel, a nasal or a stop does not.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

SR = 44100
FRAME_MS = 40
HF_HZ = 4500
HF_SHARE = 0.60   # of a frame's energy above HF_HZ
REL_DB = 18.0     # a hissy frame counts when it is this close to the loudest frame
TAIL_FRAMES = 3


def samples(path: Path) -> np.ndarray:
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.int16).astype(float) / 32768


def frames(x: np.ndarray) -> list[tuple[float, float, float]]:
    n = SR * FRAME_MS // 1000
    f = np.fft.rfftfreq(n, 1 / SR)
    out = []
    for i in range(0, len(x) - n + 1, n):
        s = x[i:i + n]
        spec = np.abs(np.fft.rfft(s * np.hanning(n))) ** 2
        out.append((i / SR * 1000, 10 * np.log10((s ** 2).mean() + 1e-12), float(spec[f > HF_HZ].sum() / (spec.sum() + 1e-18))))
    return out


def hissy_tail(path: Path) -> bool:
    fr = frames(samples(path))
    if len(fr) < 4:
        return False
    loudest = max(db for _, db, _ in fr)
    return any(db > loudest - REL_DB and hf > HF_SHARE for _, db, hf in fr[-TAIL_FRAMES:])
