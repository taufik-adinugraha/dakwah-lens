"""Retrieval smoke test — guards against MIN_SCORE drift and silent
corpus regressions.

Calibration story (see `api/services/kitab_retrieval.py::MIN_SCORE` header):
the 2026-05 thresholds were set against a 6-corpus snapshot. By 2026-06
the corpus was 19 collections and the original 0.28 floor was rejecting
90%+ of real matches for the 13 AR-only kitabs. A 27-query empirical
probe drove the recalibration; the same query set is reused here so the
test catches if that calibration slips back.

Hard skip when credentials are absent — keeps the test green in CI
runs that don't have OpenAI or prod Qdrant access. Designed to run as
part of the deploy smoke check on the VM where both are live.
"""
from __future__ import annotations

import os

import pytest

REPRESENTATIVE_QUERIES = [
    # First 10: real production `topics.label` rows spanning the
    # current-affairs surface (corruption, sosial, kriminal, ekonomi).
    "Korupsi Pejabat & Aparatur Daerah",
    "Konflik Israel-Palestina & Iran",
    "Ibadah Haji & Kepulangan Jemaah",
    "Kajian Islam & Akhlak",
    "Narkoba & Penyalahgunaan Obat",
    "Kekerasan Seksual & Perlindungan Anak",
    "Bencana Alam & Penanganan Darurat",
    "Tenaga Kerja & Kesejahteraan Buruh",
    "Pelemahan Rupiah & Dampak Ekonomi",
    "Pendidikan & Penerimaan Siswa Baru",
    # Plus 3 biographical/akhlak-shaped queries so the corpora that
    # only surface for those topics (Sirah, Syamail, Hayat as-Sahabah)
    # have a fair shot in the smoke check. Without these, the test
    # silently passes "no silent corpus" for the wrong reason: those
    # corpora literally have nothing to contribute on a corruption query.
    "Akhlak dan keseharian Rasulullah ﷺ",
    "Hijrah dan perjuangan dakwah Nabi di Mekah",
    "Kisah para sahabat Nabi dalam dakwah",
]


def _credentials_available() -> bool:
    """Both OpenAI (for query embedding) and Qdrant (for search) need
    to be reachable. We don't try to actually call them here — just
    check the env vars are present. The retrieval call itself fails
    gracefully if either backend is unreachable."""
    return bool(os.environ.get("OPENAI_API_KEY")) and bool(
        os.environ.get("QDRANT_URL")
    )


@pytest.mark.skipif(
    not _credentials_available(),
    reason="OPENAI_API_KEY or QDRANT_URL not set — integration probe skipped",
)
def test_min_score_keeps_most_corpora_contributing() -> None:
    """Across the 13-query realistic set, at least 17 of 19 corpora
    must contribute at least one candidate to at least one query's
    top-28.

    Why not "all 19 always": a separate architectural detail — after
    MIN_SCORE filtering, `retrieve_daleel` sorts ALL surviving
    candidates by raw cosine, then truncates to `limit=28`. AR-only
    matns score 0.15-0.27 cosine on a Bahasa query (the embedder maps
    cross-lingually at a lower absolute scale) while translation-
    bearing payloads score 0.30-0.50. So a few of the smallest AR-only
    corpora (currently Sirah Ibn Hisham + Shama'il, ~~p90 ≈ 0.24~~ for
    the corpus's top-1 over typical queries) get crowded out of top-28
    even when their content is on-topic. The reranker would rebalance
    them but only sees what makes the top-28. Improving that is a
    separate piece of work (per-corpus slot quotas in the final merge
    instead of global cosine sort).

    The threshold this test enforces — 17/19 — catches the regression
    that 2026-06-09 recalibration fixed (under the old 0.28 universal
    floor, 13 of 19 corpora were silent across all queries) while
    accepting the known architectural ceiling.
    """
    from api.services.kitab_retrieval import COLLECTION_NAMES, retrieve_daleel

    contributing_corpora: set[str] = set()
    for query in REPRESENTATIVE_QUERIES:
        hits = retrieve_daleel(query, limit=28, per_corpus=6)
        contributing_corpora.update(h["corpus"] for h in hits)

    silent = set(COLLECTION_NAMES) - contributing_corpora
    min_contributing = len(COLLECTION_NAMES) - 2
    assert len(contributing_corpora) >= min_contributing, (
        f"Only {len(contributing_corpora)}/{len(COLLECTION_NAMES)} corpora "
        f"contributed across the probe set. Silent: {sorted(silent)}. "
        f"Either MIN_SCORE drifted too strict, the collections are empty, "
        f"or the embedding model changed."
    )


@pytest.mark.skipif(
    not _credentials_available(),
    reason="OPENAI_API_KEY or QDRANT_URL not set — integration probe skipped",
)
def test_typical_query_returns_multi_corpus_top_28() -> None:
    """A typical briefing query (here: corruption — pulls from Quran,
    hadith, AND AR-only matns about justice/honesty) should land at
    least 5 distinct corpora in the top-28. The reranker can't pick
    diverse daleel if MIN_SCORE filters away every non-Quran source
    before merging."""
    from api.services.kitab_retrieval import retrieve_daleel

    hits = retrieve_daleel("Korupsi Pejabat & Aparatur Daerah", limit=28, per_corpus=6)
    distinct_corpora = {h["corpus"] for h in hits}
    assert len(distinct_corpora) >= 5, (
        f"Top-28 for a typical query landed only {len(distinct_corpora)} "
        f"distinct corpora ({sorted(distinct_corpora)}). Expected ≥5 — "
        f"MIN_SCORE may be too strict for the AR-only matns."
    )


@pytest.mark.skipif(
    not _credentials_available(),
    reason="OPENAI_API_KEY or QDRANT_URL not set — integration probe skipped",
)
def test_quran_and_muslim_dominate_translation_bearing_corpora() -> None:
    """Sanity check on the asymmetry the calibration preserves: Quran
    and Muslim (both have clean Bahasa translations in payload) should
    consistently land in the top-28 across most queries. If they
    suddenly drop out, something's wrong with the embeddings or with
    one of their MIN_SCOREs."""
    from api.services.kitab_retrieval import retrieve_daleel

    quran_hits = 0
    muslim_hits = 0
    for query in REPRESENTATIVE_QUERIES:
        hits = retrieve_daleel(query, limit=28, per_corpus=6)
        corpora_seen = {h["corpus"] for h in hits}
        if "quran" in corpora_seen:
            quran_hits += 1
        if "muslim" in corpora_seen:
            muslim_hits += 1

    # On the 27-query empirical probe, Quran cleared its threshold for
    # 24/27 queries and Muslim for 24/27 (~89%). On the 13-query subset
    # we expect at least 9 hits each (~70%, leaving headroom for noise).
    n = len(REPRESENTATIVE_QUERIES)
    assert quran_hits >= 9, f"Quran in top-28 for only {quran_hits}/{n} queries"
    assert muslim_hits >= 9, f"Muslim in top-28 for only {muslim_hits}/{n} queries"
