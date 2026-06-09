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
def test_no_corpus_silent_across_probe_set() -> None:
    """Across the 13-query realistic set, EVERY registered corpus must
    contribute at least ONE candidate to at least ONE query's top-28.

    Two architectural pieces support this invariant:
      1. MIN_SCORE recalibration (2026-06-09 morning) — per-corpus
         thresholds set to noise_max + buffer, so AR-only matns can
         actually clear the threshold for on-topic queries.
      2. Per-corpus slot reservation in `retrieve_daleel` (same day) —
         after threshold filtering, each corpus's BEST surviving hit
         gets a reserved seat in the top-`limit` pool, with remaining
         slots filled by global cosine. This stops high-absolute-score
         corpora (Quran ~0.40, Muslim ~0.33) from crowding out
         low-absolute-score AR-only candidates (Sirah ~0.20) that the
         reranker would otherwise pick on merit.

    Without piece 2, the smoke test reliably found Sirah + Shama'il
    silent across all queries even after MIN_SCORE was correct. They
    were clearing their own thresholds but losing the global cosine
    sort in the merge step.
    """
    from api.services.kitab_retrieval import COLLECTION_NAMES, retrieve_daleel

    contributing_corpora: set[str] = set()
    for query in REPRESENTATIVE_QUERIES:
        hits = retrieve_daleel(query, limit=28, per_corpus=6)
        contributing_corpora.update(h["corpus"] for h in hits)

    silent = set(COLLECTION_NAMES) - contributing_corpora
    assert not silent, (
        f"Corpora silent across all {len(REPRESENTATIVE_QUERIES)} probe queries: "
        f"{sorted(silent)}. Either MIN_SCORE drifted too strict for these "
        f"corpora, the per-corpus slot reservation in retrieve_daleel "
        f"regressed, the collections are empty, or the embedding model "
        f"changed."
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
