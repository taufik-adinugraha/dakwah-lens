"""Claude label batch + weekly recluster (services/claude_labels.py,
services/claude_recluster.py, workers/claude_jobs.py).

No network and no database: the Anthropic client, the DB helpers and the
embedding assignment are replaced with fakes, so these pin the logic —
prompt contents, result mapping, the manifest lifecycle, pricing, the
Thursday trigger and the survey → author → dry-run → persist loop."""

from __future__ import annotations

import asyncio
import json
import re
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from api.models.social import SentimentLabel
from api.services import claude_labels as cl
from api.services import claude_recluster as cr
from api.services import ingest_runs, keyword_gate, topic_discovery
from api.services.theme_groups import ALL_GROUP_NAMES

# ─── fakes ───────────────────────────────────────────────────────────


def usage(i: int = 100, o: int = 10, cw: int = 0, cr_: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        input_tokens=i,
        output_tokens=o,
        cache_creation_input_tokens=cw,
        cache_read_input_tokens=cr_,
    )


def message(payload: dict, *, stop: str = "end_turn", u: SimpleNamespace | None = None):
    return SimpleNamespace(
        content=[
            SimpleNamespace(type="thinking", thinking="…"),
            SimpleNamespace(type="text", text=json.dumps(payload)),
        ],
        usage=u or usage(),
        stop_reason=stop,
    )


def succeeded(custom_id: str, payload: dict, **kw) -> SimpleNamespace:
    return SimpleNamespace(
        custom_id=custom_id,
        result=SimpleNamespace(type="succeeded", message=message(payload, **kw)),
    )


def errored(custom_id: str) -> SimpleNamespace:
    return SimpleNamespace(custom_id=custom_id, result=SimpleNamespace(type="errored"))


# ─── label prompt ────────────────────────────────────────────────────


def test_system_prompt_carries_rulebook_and_rubric_but_not_the_tsv_contract():
    sp = cl.build_system_prompt()
    for group in ALL_GROUP_NAMES:
        assert group in sp
    assert "THE RULE THAT DECIDES MOST HARD CASES" in sp  # rubric body
    assert "Output contract" not in sp
    assert "Calibrated examples" in sp  # the opportunity anchors, one shared copy
    assert "Return only valid JSON" not in sp  # the Gemini output line
    assert "TSV" not in sp
    assert "{{" not in sp
    assert f"cut at {cl.TEXT_CHARS} characters" in sp
    assert sp.count("# Sentiment classification") == 0  # rubric title dropped


def test_output_schema_enums_are_the_live_label_sets():
    item = cl.output_schema()["properties"]["labels"]["items"]["properties"]
    assert set(item["theme"]["enum"]) == set(ALL_GROUP_NAMES)
    assert set(item["sentiment"]["enum"]) == {s.value for s in SentimentLabel}
    assert item["opportunity"] == {"type": "number"}


def test_request_params_cache_the_system_prompt_and_number_the_posts():
    p = cl.build_request_params("SYS", ["a\n\n b", "x" * 700], model="m")
    assert p["system"][0]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    assert p["output_config"]["effort"] == "low"
    lines = p["messages"][0]["content"].split("\n")
    assert lines[0] == "[0] a b"
    assert lines[1].startswith("[1] xxx") and lines[1].endswith("…")
    assert len(lines[1]) == len("[1] ") + cl.TEXT_CHARS + 1


# ─── parsing ─────────────────────────────────────────────────────────


def test_parse_labels_maps_indices_and_drops_bad_entries():
    payload = {
        "labels": [
            {"i": 0, "theme": "Hukum & Keadilan", "sentiment": "negative", "opportunity": 0.5},
            {
                "i": 1,
                "theme": "aqidah dan ibadah",
                "sentiment": "Positive",
                "opportunity": 0.5,
            },  # near-miss
            {"i": 2, "theme": "Lainnya", "sentiment": "neutral", "opportunity": 0.5},
            {
                "i": 2,
                "theme": "Lainnya",
                "sentiment": "neutral",
                "opportunity": 0.5,
            },  # twice → dropped
            {"i": 3, "theme": "Bukan Grup", "sentiment": "neutral", "opportunity": 0.5},  # invalid
            {
                "i": 9,
                "theme": "Lainnya",
                "sentiment": "neutral",
                "opportunity": 0.5,
            },  # out of range
            {
                "i": True,
                "theme": "Lainnya",
                "sentiment": "neutral",
                "opportunity": 0.5,
            },  # bool is not an index
        ]
    }
    labels, problems = cl.parse_labels(json.dumps(payload), 5)
    assert labels == {
        0: cl.Label("Hukum & Keadilan", "negative", 0.5),
        1: cl.Label("Aqidah & Ibadah", "positive", 0.5),
    }
    assert any("twice" in p for p in problems)
    assert any("3 of 5 posts unlabelled" in p for p in problems)


def test_parse_labels_survives_garbage():
    assert cl.parse_labels("not json", 3) == ({}, ["unparseable JSON"])


def test_collect_updates_counts_failures_and_totals_usage():
    ids = [str(uuid4()) for _ in range(4)]
    manifest = {"requests": {"r00000": ids[:2], "r00001": ids[2:], "r00002": [str(uuid4())]}}
    ok = {
        "labels": [
            {"i": 0, "theme": "Lainnya", "sentiment": "neutral", "opportunity": 0.5},
            {"i": 1, "theme": "Teknologi & AI", "sentiment": "positive", "opportunity": 0.5},
        ]
    }
    results = [
        succeeded("r00000", ok, u=usage(10, 5, 100, 0)),
        succeeded("r00001", ok, stop="max_tokens", u=usage(10, 5, 0, 100)),
        errored("r00002"),
        succeeded("r99999", ok),
    ]
    applied = cl.AppliedBatch(run_id="r", batch_id="b", model="claude-sonnet-5-5")
    updates = cl.collect_updates(manifest, results, applied)
    assert [u["b_id"] for u in updates] == [UUID(ids[0]), UUID(ids[1])]
    assert updates[1]["b_theme"] == "Teknologi & AI" and updates[1]["b_sent"] == "positive"
    assert updates[1]["b_opp"] == 0.5
    assert applied.requests_failed == 2
    assert any("unknown custom_id" in p for p in applied.problems)
    # usage counts every succeeded request, including the truncated one
    assert applied.usage.input_tokens == 20  # r99999 is unknown → not counted
    assert applied.usage.cache_write_tokens == 100
    assert applied.usage.cache_read_tokens == 100


def test_cost_is_half_price_with_cache_multipliers():
    u = cl.Usage(
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_write_tokens=1_000_000,
        cache_read_tokens=1_000_000,
    )
    # Sonnet 5.5: $2 in, $10 out; write 2x, read 0.1x; batch 50% off.
    assert cl.cost_usd("claude-sonnet-5-5", u) == pytest.approx((2 + 10 + 4 + 0.2) / 2)
    assert cl.cost_usd("claude-sonnet-5-5", u, discount=1.0) == pytest.approx(16.2)
    assert cl.cost_usd("unpriced-model", u) == 0.0


# ─── manifest lifecycle ──────────────────────────────────────────────


class FakeBatches:
    def __init__(self, status: str = "ended", results: list | None = None) -> None:
        self.status = status
        self._results = results or []
        self.created: list[dict] = []

    def create(self, requests):
        self.created = requests
        return SimpleNamespace(id="msgbatch_test")

    def retrieve(self, batch_id):
        return SimpleNamespace(id=batch_id, processing_status=self.status)

    def results(self, batch_id):
        return iter(self._results)


def fake_client(batches: FakeBatches) -> SimpleNamespace:
    return SimpleNamespace(messages=SimpleNamespace(batches=batches))


@pytest.fixture
def runs(monkeypatch):
    calls: list[tuple[str, dict]] = []

    async def start_run(task_name, **kw):
        calls.append(("start", {"task_name": task_name, **kw}))
        return UUID(int=1)

    async def finish_run(run_id, **kw):
        calls.append(("finish", {"run_id": run_id, **kw}))

    monkeypatch.setattr(ingest_runs, "start_run", start_run)
    monkeypatch.setattr(ingest_runs, "finish_run", finish_run)
    return calls


def test_submit_writes_manifest_and_one_request_per_50_posts(monkeypatch, tmp_path, runs):
    monkeypatch.setattr(cl, "MANIFEST_DIR", tmp_path)
    posts = [(uuid4(), f"post {n}") for n in range(120)]

    @asynccontextmanager
    async def session():
        yield None

    async def none(*a):
        return None

    async def since(*a):
        return datetime(2026, 11, 4, 17, 0, tzinfo=UTC)

    async def select(*a):
        return posts

    monkeypatch.setattr(cl, "SessionLocal", session)
    monkeypatch.setattr(cl, "_blocking_run", none)
    monkeypatch.setattr(cl, "_window_start", since)
    monkeypatch.setattr(cl, "select_posts", select)
    batches = FakeBatches()

    out = asyncio.run(cl.submit_daily_batch(fake_client(batches)))

    assert out == {
        "run_id": str(UUID(int=1)),
        "batch_id": "msgbatch_test",
        "posts": 120,
        "requests": 3,
    }
    assert runs == [("start", {"task_name": "claude_label_batch", "platform": "all"})]
    manifest = json.loads((tmp_path / f"{UUID(int=1)}.json").read_text())
    assert manifest["batch_id"] == "msgbatch_test"
    assert [len(v) for v in manifest["requests"].values()] == [50, 50, 20]
    assert [r["custom_id"] for r in batches.created] == list(manifest["requests"])
    last = batches.created[2]["params"]["messages"][0]["content"].split("\n")
    assert last[0] == "[0] post 100" and len(last) == 20
    assert manifest["requests"]["r00002"][0] == str(posts[100][0])


def test_poll_applies_an_ended_batch_and_files_the_manifest(monkeypatch, tmp_path, runs):
    monkeypatch.setattr(cl, "MANIFEST_DIR", tmp_path)
    ids = [str(uuid4()) for _ in range(3)]
    manifest = {
        "run_id": str(UUID(int=7)),
        "batch_id": "msgbatch_x",
        "model": "claude-sonnet-5-5",
        "created_at": "2026-11-04T17:00:00+00:00",
        "since": "2026-11-03T17:00:00+00:00",
        "n_posts": 3,
        "requests": {"r00000": ids},
    }
    (tmp_path / "x.json").write_text(json.dumps(manifest))
    written: list[dict] = []

    async def write(updates):
        written.extend(updates)

    monkeypatch.setattr(cl, "_write_updates", write)
    payload = {
        "labels": [
            {"i": 0, "theme": "Lainnya", "sentiment": "neutral", "opportunity": 0.5},
            {"i": 2, "theme": "Ekonomi & Bisnis", "sentiment": "negative", "opportunity": 0.5},
        ]
    }
    batches = FakeBatches(results=[succeeded("r00000", payload)])

    applied = asyncio.run(cl.poll_batches(fake_client(batches)))

    assert [a.posts_labelled for a in applied] == [2]
    assert [u["b_id"] for u in written] == [UUID(ids[0]), UUID(ids[2])]
    ((_, fin),) = runs
    assert fin["status"] == "success" and fin["items_stored"] == 2
    assert "1 of 3 posts unlabelled" in fin["error"]
    assert not (tmp_path / "x.json").exists()
    assert (tmp_path / "done" / "x.json").exists()


def test_poll_leaves_a_running_batch_and_fails_an_all_error_batch(monkeypatch, tmp_path, runs):
    monkeypatch.setattr(cl, "MANIFEST_DIR", tmp_path)
    manifest = {
        "run_id": str(UUID(int=8)),
        "batch_id": "msgbatch_y",
        "model": "claude-sonnet-5-5",
        "created_at": "2026-11-04T17:00:00+00:00",
        "n_posts": 1,
        "requests": {"r00000": [str(uuid4())]},
    }
    (tmp_path / "y.json").write_text(json.dumps(manifest))

    async def write(updates):
        pass

    monkeypatch.setattr(cl, "_write_updates", write)

    assert asyncio.run(cl.poll_batches(fake_client(FakeBatches(status="in_progress")))) == []
    assert (tmp_path / "y.json").exists() and runs == []

    asyncio.run(cl.poll_batches(fake_client(FakeBatches(results=[errored("r00000")]))))
    ((_, fin),) = runs
    # nothing labelled → failed, so the next window re-covers these posts
    assert fin["status"] == "failed" and fin["items_stored"] == 0


# ─── Thursday trigger ────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("started_at", "triggers"),
    [
        ("2026-11-04T17:00:05+00:00", True),  # Thu 00:00 WIB = Wed 17:00 UTC
        ("2026-11-03T17:00:05+00:00", False),  # Wed 00:00 WIB
    ],
)
def test_poll_starts_the_recluster_after_thursdays_batch(monkeypatch, started_at, triggers):
    from api.workers import claude_jobs as jobs

    monkeypatch.setattr(jobs.settings, "anthropic_labeling_api_key", "k")
    applied = cl.AppliedBatch(
        run_id="r", batch_id="b", model="claude-sonnet-5-5", started_at=started_at
    )

    async def poll():
        return [applied]

    monkeypatch.setattr(cl, "poll_batches", poll)
    usage_calls: list[dict] = []
    monkeypatch.setattr(jobs, "record_usage", lambda **kw: usage_calls.append(kw))
    delayed: list[int] = []
    monkeypatch.setattr(jobs.recluster_weekly, "delay", lambda *a, **k: delayed.append(1))

    assert jobs.label_batch_poll() == {"applied": ["b"]}
    assert usage_calls[0]["operation"] == "label_batch"
    assert bool(delayed) is triggers


# ─── recluster helpers ───────────────────────────────────────────────


def test_keyword_gate_is_the_one_topic_discovery_uses():
    assert topic_discovery.ELASTIC_HARD_BAN is keyword_gate.ELASTIC_HARD_BAN


def test_normalize_themes():
    out = cr.normalize_themes(
        [
            {
                "label": "  Banjir  Sumatera ",
                "keywords": ["Banjir", "banjir", " "],
                "min_similarity": 0.9,
            },
            {"label": "banjir sumatera", "keywords": ["x"]},  # duplicate label
            {"label": "Kosong", "keywords": []},  # no keywords
            {"label": "Magnet", "keywords": ["kpk"], "magnet": True, "min_similarity": "?"},
        ]
    )
    assert [t["label"] for t in out] == ["Banjir Sumatera", "Magnet"]
    assert out[0]["keywords"] == ["banjir"] and out[0]["min_similarity"] == 0.6
    assert out[1]["magnet"] is True and out[1]["min_similarity"] == 0.3


def test_strip_gate_failures_removes_what_the_gate_rejects():
    texts = ["kapal di perairan natuna"] * 20 + ["serangan iran ke israel"] * 2
    themes = cr.normalize_themes(
        [
            {"label": "Konflik Timur Tengah", "keywords": ["iran", "israel"]},
            {"label": "Polemik Ijazah", "keywords": ["ijazah"]},  # banned word
            {"label": "Hanya Iran", "keywords": ["iran"]},
        ]
    )
    out, warnings = cr.strip_gate_failures(themes, texts)
    assert [(t["label"], t["keywords"]) for t in out] == [("Konflik Timur Tengah", ["israel"])]
    assert any("banned label word" in w for w in warnings)
    assert any("'Hanya Iran': no keyword" in w for w in warnings)


def test_format_reports_drops_tokens_that_match_inside_words():
    count = cr.TokenCounter(["kapal di perairan"] * 10 + ["iran"] * 1 + ["hormuz memanas"] * 4)
    text = cr.format_reports(
        [
            [
                {
                    "label": "Selat Hormuz",
                    "story": "s",
                    "estimated_lines": 4,
                    "tokens": ["Hormuz", "iran", "hormuz"],
                    "near_neighbour_risk": "r",
                }
            ],
            None,
        ],
        count,
    )
    assert "tokens: hormuz (sub=4 word=4)" in text
    assert "dropped: iran (sub=11 word=1)" in text
    assert "### Shard 2: survey failed" in text


def test_pick_best_prefers_purity_at_unchanged_coverage():
    def run(rnd, n, matched, sampled=100):
        return cr.DryRun(rnd, [], [], [cr.ThemeStat("t", False, n, matched)], 0, sampled)

    wide, purer, orphaning = run(0, 90, 50), run(1, 85, 70), run(2, 50, 50)
    assert cr.pick_best([wide, purer, orphaning]) is purer


# ─── the whole recluster loop, faked ─────────────────────────────────


class FakeClaude:
    """Survey calls get one cluster; the author's first answer contains a
    catch-all theme, the revision replaces it."""

    def __init__(self) -> None:
        self.author_calls: list[list[dict]] = []
        self.surveys = 0

    @property
    def messages(self):
        return self

    def stream(self, **params):
        schema = params["output_config"]["format"]["schema"]
        if "clusters" in schema["properties"]:
            self.surveys += 1
            payload = {
                "clusters": [
                    {
                        "label": "Banjir",
                        "story": "s",
                        "estimated_lines": 3,
                        "tokens": ["banjir bandang"],
                        "near_neighbour_risk": "-",
                    }
                ]
            }
        else:
            self.author_calls.append(list(params["messages"]))
            second = {"label": "Korupsi Dana Desa", "keywords": ["kpk", "dana desa"]}
            first = {"label": "Campur Aduk", "keywords": ["suap"]}
            pick = first if len(self.author_calls) == 1 else second
            payload = {
                "themes": [
                    {
                        "label": "Banjir Sumatera",
                        "keywords": ["banjir bandang"],
                        "exclude_keywords": [],
                        "min_similarity": 0.3,
                        "magnet": False,
                        "synonyms": False,
                    },
                    {
                        **pick,
                        "exclude_keywords": [],
                        "min_similarity": 0.3,
                        "magnet": False,
                        "synonyms": False,
                    },
                ]
            }
        msg = message(payload)

        class Ctx:
            def __enter__(self):
                return SimpleNamespace(get_final_message=lambda: msg)

            def __exit__(self, *a):
                return False

        return Ctx()


def test_run_weekly_refines_a_weak_theme_and_persists_the_best_run(monkeypatch):
    posts = [
        {
            "id": uuid4(),
            "text": "banjir bandang di sumatera",
            "theme_group": "Lingkungan & Bencana",
            "posted_at": None,
        }
        for _ in range(30)
    ] + [
        {
            "id": uuid4(),
            "text": "kpk usut korupsi dana desa",
            "theme_group": "Hukum & Keadilan",
            "posted_at": None,
        }
        for _ in range(30)
    ]

    async def fetch():
        return posts

    persisted: list = []

    async def persist(p, themes):
        persisted.append(themes)
        return len(themes)

    def discover(ps, *, platform, themes_override):
        """First theme claims its keyword matches; the last takes the rest."""
        out, taken = [], set()
        for k, t in enumerate(themes_override):
            last = k == len(themes_override) - 1
            ids = [
                p["id"]
                for p in ps
                if p["id"] not in taken and (last or any(w in p["text"] for w in t["keywords"]))
            ]
            taken.update(ids)
            out.append({"label": t["label"], "keywords": t["keywords"], "post_ids": ids})
        return out

    monkeypatch.setattr(cr, "_fetch_recent_posts", fetch)
    monkeypatch.setattr(cr, "_persist", persist)
    monkeypatch.setattr(cr, "discover_topics", discover)
    fake = FakeClaude()

    result = cr.run_weekly(cr.ReclusterResult(model="claude-sonnet-5-5"), client=fake)

    assert fake.surveys == cr.SURVEY_SHARDS
    assert len(fake.author_calls) == 2  # first draft + one revision
    first_user = fake.author_calls[0][0]["content"][0]
    assert first_user["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    assert "banjir bandang (sub=30 word=30)" in first_user["text"]
    revision = fake.author_calls[1][-1]["content"][0]["text"]
    assert "== Campur Aduk  (30 posts, purity 0.00)" in revision
    assert "30 of 30 posts contain none of its keywords" in revision
    assert result.dry_runs == 2 and result.best_round == 1
    assert result.concrete_purity == 1.0 and result.assigned == 60
    assert [t["label"] for t in persisted[0]] == ["Banjir Sumatera", "Korupsi Dana Desa"]
    assert result.usage.input_tokens == 100 * (cr.SURVEY_SHARDS + 2)
    assert result.cost_usd > 0


def test_submit_cancels_a_batch_it_could_not_record(monkeypatch, tmp_path, runs):
    monkeypatch.setattr(cl, "MANIFEST_DIR", tmp_path)

    @asynccontextmanager
    async def session():
        yield None

    async def none(*a):
        return None

    async def since(*a):
        return datetime(2026, 11, 4, 17, 0, tzinfo=UTC)

    async def select(*a):
        return [(uuid4(), "post")]

    monkeypatch.setattr(cl, "SessionLocal", session)
    monkeypatch.setattr(cl, "_blocking_run", none)
    monkeypatch.setattr(cl, "_window_start", since)
    monkeypatch.setattr(cl, "select_posts", select)
    writes: list[int] = []
    real_write = cl._write_json

    def flaky_write(path, data):
        writes.append(1)
        if len(writes) == 2:  # the write that records the batch id
            raise OSError("disk full")
        real_write(path, data)

    monkeypatch.setattr(cl, "_write_json", flaky_write)
    batches = FakeBatches()
    cancelled: list[str] = []
    batches.cancel = lambda batch_id: cancelled.append(batch_id)

    with pytest.raises(OSError):
        asyncio.run(cl.submit_daily_batch(fake_client(batches)))
    assert cancelled == ["msgbatch_test"]
    assert list(tmp_path.glob("*.json")) == []
    assert runs[-1][1]["status"] == "failed"


class FakeAuthor:
    def __init__(self, reply):
        self.reply = reply
        self.asked: list[str] = []

    def ask(self, content, **kw):
        self.asked.append(content)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def test_gate_sends_failures_back_and_keeps_the_draft_if_the_repair_call_fails():
    texts = ["kapal di perairan natuna"] * 20 + ["serangan iran"] * 2
    draft = cr.normalize_themes([{"label": "Timur Tengah", "keywords": ["iran"]}])
    fixed = cr.normalize_themes([{"label": "Timur Tengah", "keywords": ["serangan iran"]}])

    author = FakeAuthor(fixed)
    assert cr._gate(author, draft, texts) == fixed
    assert len(author.asked) == 1 and "'iran'" in author.asked[0]

    broken = FakeAuthor(RuntimeError("overloaded"))
    assert cr._gate(broken, draft, texts) == draft


# ─── opportunity score ───────────────────────────────────────────────


def test_parse_labels_clamps_the_score_and_drops_a_non_number():
    def entry(i, opp):
        return {"i": i, "theme": "Lainnya", "sentiment": "neutral", "opportunity": opp}

    payload = {
        "labels": [entry(0, 1.4), entry(1, -0.2), entry(2, 0), entry(3, "high"), entry(4, True)]
    }
    labels, problems = cl.parse_labels(json.dumps(payload), 5)
    assert {i: lab.opportunity for i, lab in labels.items()} == {0: 1.0, 1: 0.0, 2: 0.0}
    assert sum("invalid label" in p for p in problems) == 2


def test_write_updates_sets_all_three_labels(monkeypatch):
    from sqlalchemy.dialects import postgresql

    seen: list = []

    class Session:
        async def execute(self, stmt, params):
            seen.append((stmt, params))

        async def commit(self):
            seen.append("commit")

    @asynccontextmanager
    async def session():
        yield Session()

    monkeypatch.setattr(cl, "SessionLocal", session)
    row = {"b_id": uuid4(), "b_theme": "Lainnya", "b_sent": "neutral", "b_opp": 0.25}
    asyncio.run(cl._write_updates([row]))

    (stmt, params), done = seen
    assert done == "commit" and params == [row]
    sql = str(stmt.compile(dialect=postgresql.dialect()))
    for col in ("theme_group", "sentiment_label", "sentiment_score", "dawah_opportunity"):
        assert f"{col}=" in sql


def test_null_score_alone_does_not_select_a_post():
    """~270,000 old posts have no score; selecting on it would re-send them all."""
    import inspect

    src = inspect.getsource(cl.select_posts)
    assert "theme_group.is_(None)" in src and "sentiment_label.is_(None)" in src
    assert "dawah_opportunity" not in src


# ─── ingest no longer classifies ─────────────────────────────────────


def test_ingest_makes_no_label_calls_and_keeps_existing_labels():
    import inspect

    from api.scripts import ingest

    src = inspect.getsource(ingest)
    assert "classify_sentiment" not in src and "classify_opportunity" not in src
    # A re-scrape carries NULLs, which must not erase Claude's labels.
    for col in ("sentiment_label", "sentiment_score", "dawah_opportunity", "theme_group"):
        assert re.search(
            rf'"{col}": func\.coalesce\(\s*insert\(SocialPost\)\.excluded\.{col},', src
        ), col


def test_gemini_retry_is_off_the_schedule_but_still_runnable():
    from api.workers.celery_app import celery_app

    celery_app.loader.import_default_modules()
    assert "retry-failed-sentiment" not in celery_app.conf.beat_schedule
    assert "api.workers.ingest.retry_failed_sentiment" in celery_app.tasks


# ─── trending list ───────────────────────────────────────────────────


def test_trending_headlines_leave_out_zero_scored_posts():
    from api.services import trending_headlines as th

    seen: list[str] = []

    class Session:
        async def execute(self, stmt, params):
            seen.append(str(stmt))
            return SimpleNamespace(all=lambda: [])

    asyncio.run(th.fetch_trending_headlines(Session()))
    assert "(dawah_opportunity IS NULL OR dawah_opportunity > 0)" in seen[0]
    assert "ORDER BY dawah_opportunity DESC NULLS LAST" in seen[0]


# ─── topic corpus held steady ────────────────────────────────────────


def _sql(clause) -> str:
    from sqlalchemy.dialects import postgresql

    return str(clause.compile(dialect=postgresql.dialect()))


def test_score_does_not_shape_the_topic_corpus_while_the_switch_is_off():
    from api.scripts import cluster_topics as ct

    assert ct.OPPORTUNITY_SHAPES_CORPUS is False
    floor = _sql(ct._corpus_floor(True))
    assert "dawah_opportunity IS NULL" in floor and "dawah_opportunity >" in floor
    assert ">=" not in floor
    order = [_sql(c) for c in ct._corpus_day_order()]
    assert order == ["social_posts.posted_at DESC"]
    assert ct._corpus_floor(False) is None


def test_the_switch_restores_the_floor_and_the_score_ranking(monkeypatch):
    from api.scripts import cluster_topics as ct

    monkeypatch.setattr(ct, "OPPORTUNITY_SHAPES_CORPUS", True)
    assert "dawah_opportunity >=" in _sql(ct._corpus_floor(True))
    first, second = ct._corpus_day_order()
    assert "coalesce(social_posts.dawah_opportunity" in _sql(first)
    assert _sql(second) == "social_posts.posted_at DESC"
