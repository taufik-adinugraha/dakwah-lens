"""Weekly topic recluster by Claude — the automated twin of the manual
`scripts/cluster_topics/run.sh` + `inject.sh` flow (operator decision
2026-11-01: Thursday, after the 00:00 WIB label batch is applied).

Same corpus, same rules, same gate, same assignment as the manual run;
only the hands change:

  1. fetch     `_fetch_recent_posts()` — the corpus `inject` assigns over
  2. survey    SURVEY_SHARDS parallel calls, one per shard of the discovery
               sample (`prompts/cluster_survey.md`, the API-mode twin of
               `scripts/cluster_topics/SURVEY_PROMPT.md`)
  3. verify    every proposed token re-counted over the full corpus; tokens
               failing word ≥ 0.85 × sub are dropped (`verify_reports.py`)
  4. author    one conversation (`prompts/cluster_api_preamble.md` +
               `prompts/cluster_themes_guide.md`, the manual run's guide)
  5. gate      `keyword_gate.check_themes`; failures go back to the author
               for up to GATE_REPAIR_ROUNDS, then failing keywords are
               stripped (the operator chose "inject anyway")
  6. dry run   `discover_topics(themes_override=…)`, nothing persisted;
               concrete themes under PURITY_TARGET go back with the
               `peek_topic.sh` view, up to REFINE_ROUNDS
  7. persist   the best dry run via `_persist()` — full topic rebuild

Zero Gemini: with `themes_override` the assignment is embedding cosine
only. Every Claude call runs on `anthropic_labeling_api_key`.
"""

from __future__ import annotations

import asyncio
import json
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog

from api.config import settings
from api.scripts.cluster_topics import (
    MIN_POSTS_FOR_DISCOVERY,
    UNIFIED_PLATFORM,
    _fetch_recent_posts,
    _persist,
)
from api.services.claude_labels import Usage, cost_usd
from api.services.keyword_gate import check_themes, describe_failures, word_re
from api.services.topic_discovery import (
    FALLBACK_LABEL,
    SAMPLE_SIZE,
    build_discovery_user_prompt,
    discover_topics,
)

log = structlog.get_logger()

TASK_NAME = "claude_recluster_weekly"
PLATFORM = "all"

SURVEY_SHARDS = 10
SURVEY_PARALLEL = 4
SURVEY_MAX_TOKENS = 16_000
AUTHOR_MAX_TOKENS = 32_000
GATE_REPAIR_ROUNDS = 2
REFINE_ROUNDS = 2
PURITY_TARGET = 0.60
PEEK_MIN_POSTS = 15
PEEK_SAMPLES = 25
TOKEN_WORD_RATIO = 0.85
SUBSAMPLE_LINES = 600
# The best dry run is the purest one among those keeping at least this
# share of the widest coverage seen — purity bought by orphaning posts is
# not an improvement.
COVERAGE_TOLERANCE = 0.9
MIN_SIMILARITY_RANGE = (0.20, 0.60)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"

_STR = {"type": "string"}
_STR_LIST = {"type": "array", "items": _STR}

SURVEY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": _STR,
                    "story": _STR,
                    "estimated_lines": {"type": "integer"},
                    "tokens": _STR_LIST,
                    "near_neighbour_risk": _STR,
                },
                "required": [
                    "label",
                    "story",
                    "estimated_lines",
                    "tokens",
                    "near_neighbour_risk",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clusters"],
    "additionalProperties": False,
}

THEMES_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "themes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": _STR,
                    "keywords": _STR_LIST,
                    "exclude_keywords": _STR_LIST,
                    "min_similarity": {"type": "number"},
                    "magnet": {"type": "boolean"},
                    "synonyms": {"type": "boolean"},
                },
                "required": [
                    "label",
                    "keywords",
                    "exclude_keywords",
                    "min_similarity",
                    "magnet",
                    "synonyms",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["themes"],
    "additionalProperties": False,
}


# ─── Claude calls ────────────────────────────────────────────────────


class ClaudeCalls:
    """Thin wrapper: streams each call (long inputs), totals usage across
    threads, and returns the parsed JSON of the structured output."""

    def __init__(self, client: Any, model: str) -> None:
        self.client = client
        self.model = model
        self.usage = Usage()
        self._lock = threading.Lock()

    def json(
        self,
        *,
        system: Any,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int,
        effort: str = "medium",
    ) -> tuple[dict[str, Any], Any]:
        with self.client.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": schema},
            },
        ) as stream:
            msg = stream.get_final_message()
        with self._lock:
            self.usage.add(msg.usage)
        if msg.stop_reason != "end_turn":
            raise RuntimeError(f"Claude stopped with stop_reason={msg.stop_reason}")
        text = next((b.text for b in msg.content if b.type == "text"), "")
        return json.loads(text), msg


def make_client() -> Any:
    import anthropic

    # Generous retries: 429/529 back off instead of failing the week's run.
    return anthropic.Anthropic(api_key=settings.anthropic_labeling_api_key, max_retries=8)


# ─── corpus helpers ──────────────────────────────────────────────────


def sample_lines(posts: list[dict[str, Any]]) -> list[str]:
    """The discovery sample, one `- text` line per post — exactly what the
    manual run's `sample.md` holds."""
    prompt = build_discovery_user_prompt(posts, platform=UNIFIED_PLATFORM, sample_size=SAMPLE_SIZE)
    return [line for line in prompt.split("\n") if line.startswith("- ")]


def shard(lines: list[str], n: int) -> list[list[str]]:
    per = max(1, -(-len(lines) // n))
    return [lines[k : k + per] for k in range(0, len(lines), per)]


def every_kth(items: list[Any], limit: int) -> list[Any]:
    if len(items) <= limit:
        return list(items)
    step = len(items) / limit
    return [items[int(k * step)] for k in range(limit)]


def theme_group_volume(posts: list[dict[str, Any]]) -> list[tuple[str, int]]:
    c = Counter(p.get("theme_group") or "(null)" for p in posts)
    return c.most_common()


class TokenCounter:
    """Substring vs whole-word counts over the full corpus, memoised."""

    def __init__(self, texts: list[str]) -> None:
        self.texts = [(t or "").lower() for t in texts]
        self._memo: dict[str, tuple[int, int]] = {}

    def __call__(self, token: str) -> tuple[int, int]:
        k = token.lower().strip()
        if k not in self._memo:
            pat = word_re(k)
            sub = sum(1 for x in self.texts if k in x)
            word = sum(1 for x in self.texts if pat.search(x))
            self._memo[k] = (sub, word)
        return self._memo[k]


def token_is_clean(sub: int, word: int) -> bool:
    return word > 0 and word >= TOKEN_WORD_RATIO * sub


def format_reports(reports: list[list[dict[str, Any]] | None], count: TokenCounter) -> str:
    """The verified survey reports, as the author reads them."""
    out: list[str] = []
    for n, clusters in enumerate(reports, start=1):
        if clusters is None:
            out.append(f"### Shard {n}: survey failed — no report\n")
            continue
        out.append(f"### Shard {n}")
        for c in clusters:
            kept, dropped = [], []
            for tok in dict.fromkeys(t.strip().lower() for t in c.get("tokens", [])):
                if not tok:
                    continue
                sub, word = count(tok)
                entry = f"{tok} (sub={sub} word={word})"
                (kept if token_is_clean(sub, word) else dropped).append(entry)
            out.append(
                f"## {c.get('label', '?')}  (~{c.get('estimated_lines', '?')} lines in shard)"
            )
            out.append(str(c.get("story", "")))
            out.append("tokens: " + (", ".join(kept) or "(none passed)"))
            if dropped:
                out.append("dropped: " + ", ".join(dropped))
            out.append(f"near-neighbour risk: {c.get('near_neighbour_risk', '')}")
            out.append("")
    return "\n".join(out)


# ─── themes ──────────────────────────────────────────────────────────


def normalize_themes(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Lowercase + dedupe keywords, clamp floors, drop unusable entries."""
    lo, hi = MIN_SIMILARITY_RANGE
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for t in raw:
        label = " ".join(str(t.get("label", "")).split())
        if not label or label.lower() in seen:
            continue
        kws = [
            k
            for k in dict.fromkeys(" ".join(str(k).lower().split()) for k in t.get("keywords", []))
            if k
        ]
        if not kws:
            continue
        excl = [
            k
            for k in dict.fromkeys(
                " ".join(str(k).lower().split()) for k in t.get("exclude_keywords", [])
            )
            if k
        ]
        try:
            floor = float(t.get("min_similarity", 0.3))
        except (TypeError, ValueError):
            floor = 0.3
        seen.add(label.lower())
        out.append(
            {
                "label": label,
                "keywords": kws,
                "exclude_keywords": excl,
                "min_similarity": round(min(hi, max(lo, floor)), 3),
                "magnet": bool(t.get("magnet")),
                "synonyms": bool(t.get("synonyms")),
            }
        )
    return out


def strip_gate_failures(
    themes: list[dict[str, Any]], texts: list[str]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Last resort after the repair rounds: remove what the gate rejects.

    A banned label word makes `topic_discovery` drop the theme anyway, so
    the theme goes; an inflated or incoherent keyword goes; a theme left
    with no keyword goes. Each removal is returned as a warning."""
    report = check_themes(themes, texts)
    bad = {(label, kw.lower()) for label, kw, *_ in report.inflated + report.incoherent}
    banned = {label for label, _ in report.banned}
    warnings: list[str] = []
    out: list[dict[str, Any]] = []
    for t in themes:
        if t["label"] in banned:
            warnings.append(f"dropped theme {t['label']!r}: banned label word")
            continue
        kept = [k for k in t["keywords"] if (t["label"], k) not in bad]
        for k in t["keywords"]:
            if k not in kept:
                warnings.append(f"stripped keyword {k!r} from {t['label']!r}")
        if not kept:
            warnings.append(f"dropped theme {t['label']!r}: no keyword passed the gate")
            continue
        out.append({**t, "keywords": kept})
    return out, warnings


# ─── dry runs ────────────────────────────────────────────────────────


@dataclass
class ThemeStat:
    label: str
    magnet: bool
    n: int
    matched: int

    @property
    def purity(self) -> float:
        return self.matched / self.n if self.n else 0.0


@dataclass
class DryRun:
    round: int
    themes: list[dict[str, Any]]
    assigned: list[dict[str, Any]]
    stats: list[ThemeStat]
    orphans: int
    sampled: int

    @property
    def coverage(self) -> float:
        return sum(s.n for s in self.stats) / self.sampled if self.sampled else 0.0

    @property
    def concrete_purity(self) -> float:
        concrete = [s for s in self.stats if not s.magnet]
        n = sum(s.n for s in concrete)
        return sum(s.matched for s in concrete) / n if n else 0.0

    def weak(self) -> list[ThemeStat]:
        return [
            s
            for s in self.stats
            if not s.magnet and s.n >= PEEK_MIN_POSTS and s.purity < PURITY_TARGET
        ]


def measure(
    round_no: int,
    themes: list[dict[str, Any]],
    assigned: list[dict[str, Any]],
    text_by_id: dict[Any, str],
    sampled: int,
) -> DryRun:
    """Per-theme purity exactly as `topic_discovery`'s purity audit and the
    manual runs measure it: share of a theme's posts containing any of its
    keywords as a literal substring."""
    magnet = {t["label"]: t["magnet"] for t in themes}
    stats: list[ThemeStat] = []
    orphans = 0
    for a in assigned:
        if a["label"] == FALLBACK_LABEL:
            orphans = len(a["post_ids"])
            continue
        kws = [k.lower() for k in a.get("keywords", []) if k]
        matched = sum(1 for pid in a["post_ids"] if any(k in text_by_id.get(pid, "") for k in kws))
        stats.append(
            ThemeStat(a["label"], magnet.get(a["label"], False), len(a["post_ids"]), matched)
        )
    return DryRun(round_no, themes, assigned, stats, orphans, sampled)


def pick_best(runs: list[DryRun]) -> DryRun:
    widest = max(r.coverage for r in runs)
    eligible = [r for r in runs if r.coverage >= COVERAGE_TOLERANCE * widest]
    return max(eligible, key=lambda r: r.concrete_purity)


def describe_dry_run(
    run: DryRun,
    posts_by_id: dict[Any, dict[str, Any]],
    text_by_id: dict[Any, str],
) -> str:
    """The dry-run table plus the `peek_topic.sh` view of each weak theme."""
    lines = [
        f"Dry run {run.round}: {len(run.stats)} themes, "
        f"{sum(s.n for s in run.stats)} of {run.sampled} sampled posts assigned "
        f"({run.coverage:.0%}), {run.orphans} orphans, "
        f"concrete-theme purity {run.concrete_purity:.2f}.",
        "",
        "posts | purity | magnet | label",
    ]
    for s in sorted(run.stats, key=lambda s: -s.n):
        lines.append(
            f"{s.n:5d} | {s.purity:.2f}   | {'yes' if s.magnet else 'no ':3s}    | {s.label}"
        )
    weak = run.weak()
    if weak:
        lines += ["", f"Concrete themes below {PURITY_TARGET:.2f}:"]
    by_label = {a["label"]: a for a in run.assigned}
    for s in weak:
        a = by_label[s.label]
        kws = [k.lower() for k in a.get("keywords", []) if k]
        mix = Counter(
            posts_by_id[pid].get("theme_group") or "(null)"
            for pid in a["post_ids"]
            if pid in posts_by_id
        )
        lacking = [
            pid for pid in a["post_ids"] if not any(k in text_by_id.get(pid, "") for k in kws)
        ]
        lines += [
            "",
            f"== {s.label}  ({s.n} posts, purity {s.purity:.2f})",
            "theme_group mix: " + ", ".join(f"{g} {n}" for g, n in mix.most_common()),
            f"{len(lacking)} of {s.n} posts contain none of its keywords. Sample:",
        ]
        for pid in every_kth(lacking, PEEK_SAMPLES):
            p = posts_by_id.get(pid, {})
            text = " ".join((p.get("text") or "").split())[:120]
            lines.append(f"  {p.get('theme_group') or '-'} | {text}")
    return "\n".join(lines)


# ─── the run ─────────────────────────────────────────────────────────


@dataclass
class ReclusterResult:
    model: str
    posts: int = 0
    themes_persisted: int = 0
    assigned: int = 0
    concrete_purity: float = 0.0
    dry_runs: int = 0
    best_round: int = 0
    warnings: list[str] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)

    @property
    def cost_usd(self) -> float:
        # Regular API: full price; the cached prefix uses the 1h TTL.
        return cost_usd(self.model, self.usage, discount=1.0)


def _survey(calls: ClaudeCalls, lines: list[str], n_posts: int) -> list[dict[str, Any]] | None:
    system = (
        (PROMPT_DIR / "cluster_survey.md")
        .read_text(encoding="utf-8")
        .replace("{{N_POSTS}}", str(n_posts))
        .replace("{{N_LINES}}", str(len(lines)))
    )
    try:
        data, _ = calls.json(
            system=system,
            messages=[{"role": "user", "content": "\n".join(lines)}],
            schema=SURVEY_SCHEMA,
            max_tokens=SURVEY_MAX_TOKENS,
        )
    except Exception:
        log.exception("claude_recluster.survey_failed", lines=len(lines))
        return None
    return list(data.get("clusters", []))


class Author:
    """The authoring conversation. The system prompt and the first user
    message (reports + sample) are cached, so revision rounds re-read them
    at the cache-read price."""

    def __init__(self, calls: ClaudeCalls) -> None:
        self.calls = calls
        guide = (PROMPT_DIR / "cluster_themes_guide.md").read_text(encoding="utf-8")
        preamble = (PROMPT_DIR / "cluster_api_preamble.md").read_text(encoding="utf-8")
        self.system = [
            {
                "type": "text",
                "text": preamble + guide,
                "cache_control": {"type": "ephemeral", "ttl": "1h"},
            }
        ]
        self.messages: list[dict[str, Any]] = []

    def ask(self, content: str, *, cache: bool = False) -> list[dict[str, Any]]:
        block: dict[str, Any] = {"type": "text", "text": content}
        if cache:
            block["cache_control"] = {"type": "ephemeral", "ttl": "1h"}
        self.messages.append({"role": "user", "content": [block]})
        data, msg = self.calls.json(
            system=self.system,
            messages=self.messages,
            schema=THEMES_SCHEMA,
            max_tokens=AUTHOR_MAX_TOKENS,
        )
        # The reply goes back verbatim (thinking blocks included).
        self.messages.append({"role": "assistant", "content": msg.content})
        return normalize_themes(data.get("themes", []))


def _gate(author: Author, themes: list[dict[str, Any]], texts: list[str]) -> list[dict[str, Any]]:
    for _ in range(GATE_REPAIR_ROUNDS):
        report = check_themes(themes, texts)
        if report.ok:
            return themes
        try:
            themes = author.ask(
                "The keyword gate failed:\n"
                + describe_failures(report)
                + "\n\nReturn the complete revised themes JSON "
                "(every theme, not only the changed ones)."
            )
        except Exception:
            # Inject anyway: keep the draft; strip_gate_failures cleans it.
            log.exception("claude_recluster.gate_repair_failed")
            break
    return themes


def first_message(posts: list[dict[str, Any]], reports_text: str, lines: list[str]) -> str:
    vol = "\n".join(f"  {n:5d}  {g}" for g, n in theme_group_volume(posts))
    sub = every_kth(lines, SUBSAMPLE_LINES)
    return (
        f"This week's corpus: {len(posts)} posts (the 7-day window); the "
        f"discovery sample holds {len(lines)} of them.\n\n"
        f"theme_group volume over the whole corpus:\n{vol}\n\n"
        f"Survey reports, tokens re-counted over the whole corpus:\n\n{reports_text}\n\n"
        f"An evenly spaced {len(sub)}-line subsample of the discovery sample, for "
        f"grounding:\n" + "\n".join(sub) + "\n\nAuthor the themes JSON now."
    )


def run_weekly(result: ReclusterResult | None = None, client: Any | None = None) -> ReclusterResult:
    """One full run, filling `result` as it goes, so a caller that catches
    a failure still sees the spend. Sync on purpose: `discover_topics`
    records embedding spend with `record_usage`, which only lands when
    called outside a running event loop."""
    result = result or ReclusterResult(model=settings.labeling_model)
    calls = ClaudeCalls(client or make_client(), result.model)
    result.usage = calls.usage

    posts = asyncio.run(_fetch_recent_posts())
    result.posts = len(posts)
    if len(posts) < MIN_POSTS_FOR_DISCOVERY:
        raise RuntimeError(f"only {len(posts)} posts in the window")
    texts = [p.get("text") or "" for p in posts]
    text_by_id = {p["id"]: t.lower() for p, t in zip(posts, texts, strict=True)}
    posts_by_id = {p["id"]: p for p in posts}
    sampled = min(len(posts), SAMPLE_SIZE)

    lines = sample_lines(posts)
    shards = shard(lines, SURVEY_SHARDS)
    with ThreadPoolExecutor(SURVEY_PARALLEL) as ex:
        reports = list(ex.map(lambda sh: _survey(calls, sh, len(posts)), shards))
    failed = sum(r is None for r in reports)
    if failed == len(reports):
        raise RuntimeError("every survey shard failed")
    if failed:
        result.warnings.append(f"{failed} of {len(reports)} survey shards failed")

    author = Author(calls)
    themes = author.ask(
        first_message(posts, format_reports(reports, TokenCounter(texts)), lines),
        cache=True,
    )
    themes = _gate(author, themes, texts)
    themes, stripped = strip_gate_failures(themes, texts)
    result.warnings += stripped

    runs: list[DryRun] = []
    for round_no in range(REFINE_ROUNDS + 1):
        if not themes:
            result.warnings.append(f"round {round_no}: no usable themes")
            break
        assigned = discover_topics(posts, platform=UNIFIED_PLATFORM, themes_override=themes)
        run = measure(round_no, themes, assigned, text_by_id, sampled)
        runs.append(run)
        log.info(
            "claude_recluster.dry_run",
            round=round_no,
            themes=len(run.stats),
            coverage=round(run.coverage, 3),
            concrete_purity=round(run.concrete_purity, 3),
            weak=[s.label for s in run.weak()],
        )
        if not run.weak() or round_no == REFINE_ROUNDS:
            break
        try:
            themes = author.ask(
                describe_dry_run(run, posts_by_id, text_by_id)
                + "\n\nRe-author with the guide's fixes and return the "
                "complete revised themes JSON."
            )
            themes = _gate(author, themes, texts)
            themes, stripped = strip_gate_failures(themes, texts)
            result.warnings += [f"round {round_no + 1}: {w}" for w in stripped]
        except Exception as exc:
            # A failed revision keeps what we already have.
            result.warnings.append(f"round {round_no + 1} revision failed: {exc}")
            log.exception("claude_recluster.revision_failed", round=round_no + 1)
            break

    if not runs:
        raise RuntimeError("no dry run produced themes")
    best = pick_best(runs)
    if not best.stats:
        raise RuntimeError("the best dry run assigned no posts; topics left as they were")
    result.dry_runs = len(runs)
    result.best_round = best.round
    result.concrete_purity = best.concrete_purity
    result.assigned = sum(s.n for s in best.stats)
    for s in best.weak():
        result.warnings.append(f"persisted below target: {s.label!r} {s.purity:.2f} ({s.n} posts)")
    result.themes_persisted = asyncio.run(_persist(posts, best.assigned))
    return result
