"""Unit tests for the orphan-rescue helpers in topic_discovery.

The rescue path was added 2026-06-07 after an audit found 231 of 1394
Lainnya posts had strong keyword matches to existing topics but had
fallen below the 0.28 cosine floor at top-1 assignment. These helpers
are extracted as pure functions (no embedding I/O, no DB) so we can
unit-test them with synthetic numpy matrices.
"""

from __future__ import annotations

import numpy as np

from api.services.topic_discovery import (
    _derive_theme_groups,
    _rescue_in_group_orphans,
)


# ───────────────────────── _derive_theme_groups ──────────────────────


def test_derive_theme_groups_majority_vote() -> None:
    """Theme's coarse group is the modal `theme_group` of its posts."""
    sample = [
        {"id": "p1", "theme_group": "Hukum & Keadilan"},
        {"id": "p2", "theme_group": "Hukum & Keadilan"},
        {"id": "p3", "theme_group": "Ekonomi & Bisnis"},
        {"id": "p4", "theme_group": "Sosial & Keluarga"},
        {"id": "p5", "theme_group": "Sosial & Keluarga"},
    ]
    # theme 0: 2× Hukum, 1× Ekonomi → Hukum
    # theme 1: 2× Sosial → Sosial
    theme_post_ids = [["p1", "p2", "p3"], ["p4", "p5"]]
    assert _derive_theme_groups(theme_post_ids, sample) == [
        "Hukum & Keadilan",
        "Sosial & Keluarga",
    ]


def test_derive_theme_groups_empty_theme_returns_none() -> None:
    """A theme with no assigned posts yet returns None."""
    sample = [{"id": "p1", "theme_group": "Hukum & Keadilan"}]
    assert _derive_theme_groups([["p1"], []], sample) == [
        "Hukum & Keadilan",
        None,
    ]


def test_derive_theme_groups_missing_theme_group_skipped() -> None:
    """Posts with NULL theme_group are skipped in the vote — if every
    assigned post is NULL, the theme's group is None."""
    sample = [
        {"id": "p1", "theme_group": None},
        {"id": "p2", "theme_group": None},
        {"id": "p3", "theme_group": "Ekonomi & Bisnis"},
    ]
    # theme 0: both posts have NULL theme_group → no votes → None
    # theme 1: 1× Ekonomi → Ekonomi
    assert _derive_theme_groups([["p1", "p2"], ["p3"]], sample) == [
        None,
        "Ekonomi & Bisnis",
    ]


# ────────────────────── _rescue_in_group_orphans ─────────────────────


def _make_themes(n: int) -> list[dict]:
    """Build N themes with no exclude_keywords for the simple cases."""
    return [
        {"label": f"T{i}", "exclude_keywords": [], "min_similarity": 0.28}
        for i in range(n)
    ]


def test_rescue_picks_best_in_group_above_floor() -> None:
    """A post whose theme_group matches T1's group, with cosine 0.22
    (≥ rescue floor 0.20), should be rescued into T1."""
    sims = np.array(
        [
            # T0      T1      T2
            [0.10, 0.22, 0.05],
        ]
    )
    themes = _make_themes(3)
    # T0 belongs to a different group; T1 + T2 share the orphan's group.
    theme_group_per_theme = [
        "Ekonomi & Bisnis",
        "Hukum & Keadilan",
        "Hukum & Keadilan",
    ]
    rescues = _rescue_in_group_orphans(
        orphan_rows=[0],
        orphan_metadata=[(99, "post text", "Hukum & Keadilan")],
        sims=sims,
        themes=themes,
        theme_group_per_theme=theme_group_per_theme,
        rescue_floor=0.20,
    )
    # In-group candidates = [T1, T2]; best by cosine = T1 (0.22 ≥ 0.20).
    assert rescues == [(0, 1)]


def test_rescue_drops_when_best_cosine_below_floor() -> None:
    """If even the best in-group candidate falls below RESCUE_FLOOR,
    the orphan stays orphan."""
    sims = np.array([[0.50, 0.18, 0.10]])
    themes = _make_themes(3)
    theme_group_per_theme = [
        "Ekonomi & Bisnis",
        "Hukum & Keadilan",
        "Hukum & Keadilan",
    ]
    rescues = _rescue_in_group_orphans(
        orphan_rows=[0],
        orphan_metadata=[(99, "post text", "Hukum & Keadilan")],
        sims=sims,
        themes=themes,
        theme_group_per_theme=theme_group_per_theme,
        rescue_floor=0.20,
    )
    # In-group best is T1 (0.18) < 0.20 → no rescue. T0's 0.50 is
    # ignored because it belongs to a different group.
    assert rescues == []


def test_rescue_skips_lainnya_theme_group() -> None:
    """Orphans whose theme_group is 'Lainnya' have nothing to constrain
    against, so they stay orphan even with high cosines."""
    sims = np.array([[0.90, 0.90]])
    themes = _make_themes(2)
    theme_group_per_theme = ["Ekonomi & Bisnis", "Hukum & Keadilan"]
    rescues = _rescue_in_group_orphans(
        orphan_rows=[0],
        orphan_metadata=[(99, "post", "Lainnya")],
        sims=sims,
        themes=themes,
        theme_group_per_theme=theme_group_per_theme,
        rescue_floor=0.20,
    )
    assert rescues == []


def test_rescue_skips_missing_theme_group() -> None:
    """Orphans with NULL theme_group are skipped — same rationale as
    the Lainnya case."""
    sims = np.array([[0.90, 0.90]])
    themes = _make_themes(2)
    rescues = _rescue_in_group_orphans(
        orphan_rows=[0],
        orphan_metadata=[(99, "post", None)],
        sims=sims,
        themes=themes,
        theme_group_per_theme=["Ekonomi & Bisnis", "Hukum & Keadilan"],
        rescue_floor=0.20,
    )
    assert rescues == []


def test_rescue_respects_exclude_keywords() -> None:
    """If the best in-group candidate would be excluded by an
    exclude_keyword, the orphan stays orphan (we do NOT fall through to
    the second-best in-group candidate — keep the rescue conservative)."""
    sims = np.array([[0.30, 0.10]])
    themes = [
        {
            "label": "T0",
            "exclude_keywords": ["sepakbola"],
            "min_similarity": 0.28,
        },
        {"label": "T1", "exclude_keywords": [], "min_similarity": 0.28},
    ]
    theme_group_per_theme = ["Sosial & Keluarga", "Sosial & Keluarga"]
    rescues = _rescue_in_group_orphans(
        orphan_rows=[0],
        orphan_metadata=[(99, "ini sepakbola di sini", "Sosial & Keluarga")],
        sims=sims,
        themes=themes,
        theme_group_per_theme=theme_group_per_theme,
        rescue_floor=0.20,
    )
    # T0 excluded by 'sepakbola'; T1's 0.10 < floor → no rescue.
    assert rescues == []


def test_rescue_skips_when_no_in_group_theme_exists() -> None:
    """Orphan's theme_group has no LLM-discovered theme this week
    (theme_group_per_theme has no matching entry) → stay orphan."""
    sims = np.array([[0.99, 0.99]])
    themes = _make_themes(2)
    rescues = _rescue_in_group_orphans(
        orphan_rows=[0],
        orphan_metadata=[(99, "post", "Toleransi & Lintas-Iman")],
        sims=sims,
        themes=themes,
        theme_group_per_theme=["Ekonomi & Bisnis", "Hukum & Keadilan"],
        rescue_floor=0.20,
    )
    assert rescues == []


def test_rescue_handles_multiple_orphans() -> None:
    """A mix of rescuable + non-rescuable orphans returns only the
    rescuable indices, with correct theme assignments."""
    sims = np.array(
        [
            [0.10, 0.25, 0.05],  # orphan 0 — rescuable into T1
            [0.30, 0.05, 0.05],  # orphan 1 — best in-group is T1 (0.05) < floor
            [0.05, 0.05, 0.40],  # orphan 2 — rescuable into T2
        ]
    )
    themes = _make_themes(3)
    theme_group_per_theme = [
        "Ekonomi & Bisnis",  # T0
        "Hukum & Keadilan",  # T1
        "Sosial & Keluarga",  # T2
    ]
    orphan_metadata = [
        (10, "post 0", "Hukum & Keadilan"),
        (11, "post 1", "Hukum & Keadilan"),
        (12, "post 2", "Sosial & Keluarga"),
    ]
    rescues = _rescue_in_group_orphans(
        orphan_rows=[0, 1, 2],
        orphan_metadata=orphan_metadata,
        sims=sims,
        themes=themes,
        theme_group_per_theme=theme_group_per_theme,
        rescue_floor=0.20,
    )
    # Orphan 0 → T1, orphan 1 stays orphan, orphan 2 → T2.
    assert rescues == [(0, 1), (2, 2)]
