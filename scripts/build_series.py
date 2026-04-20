#!/usr/bin/env python3
"""Builder for content/viz/series.json.

Reads:
- `content/sparknotes/twotm-chapters.json` and `tsotf-chapters.json`
  (chapter summaries fetched from SparknotesAI)
- `content/viz/tsotf-worlds.json` (hand-authored: which of Res / Luceum /
  Obiteum each TSOTF chapter inhabits)

Emits `content/viz/series.json`: one chapter-by-chapter list with `worlds`
(TWOTM is always ["Res"], TSOTF comes from the hand-authored overrides) and
`annotations` (typed events detected by keyword).

Edit the annotation keyword dicts at the top of this file to tune what fires.
Edit content/viz/tsotf-worlds.json to change per-chapter worlds.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TWOTM_PATH = ROOT / "content" / "sparknotes" / "twotm-chapters.json"
TSOTF_PATH = ROOT / "content" / "sparknotes" / "tsotf-chapters.json"
TSOTF_WORLDS_PATH = ROOT / "content" / "viz" / "tsotf-worlds.json"
OUT_PATH = ROOT / "content" / "viz" / "series.json"

VALID_WORLDS = {"Res", "Luceum", "Obiteum"}
# Rendering order (top -> bottom). Normalizing to this order keeps series.json
# diffs stable regardless of how the author wrote the overrides.
WORLD_ORDER = {"Luceum": 0, "Res": 1, "Obiteum": 2}

# Regex families per annotation type. First match per type per chapter wins.
# Patterns intentionally favor SparknotesAI phrasing (present-tense recap).
ANNOTATION_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "death": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\b(?:is\s+)?killed\b",
            r"\bkills\b",
            r"\bdies\b",
            r"\bis\s+dead\b",
            r"\bexecut(?:es|ed|ion)\b",
            r"\bmurder(?:s|ed)\b",
            r"\bslays?\b",
            r"\bfalls?\s+dead\b",
            r"\bperishes\b",
            r"\bbleeds?\s+out\b",
            r"\bstabs?\s+\w+\s+to\s+death\b",
        )
    ),
    "reveal": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\breveals?\b",
            r"\bdiscovers?\b",
            r"\bconfesses?\b",
            r"\badmits?\b",
            r"\bexposes?\b",
            r"\buncovers?\b",
            r"\bthe\s+truth\s+(?:about|of)\b",
            r"\bturns\s+out\s+to\s+be\b",
        )
    ),
    "ally_or_betrayal": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\bbetrays?\b",
            r"\ballies?\s+with\b",
            r"\breconciles?\b",
            r"\bswears?\s+(?:to|an\s+oath)\b",
            r"\bturns?\s+on\b",
            r"\bforgives?\b",
            r"\bjoins?\s+forces\b",
            r"\bpledges?\b",
            r"\bbreaks?\s+with\b",
            r"\bfirst\s+meets?\b",
        )
    ),
    "action": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\battacks?\b",
            r"\bambushes?\b",
            r"\bduels?\b",
            r"\bbattle\b",
            r"\bcharges\s+(?:at|into)\b",
            r"\bflees?\b",
            r"\bsiege\b",
            r"\braid\b",
            r"\bfights?\b",
            r"\bstrikes?\s+down\b",
            r"\bclashes?\b",
            r"\bescapes?\b",
            r"\bchases?\b",
        )
    ),
    "breakthrough": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\bCedes?\b",
            r"\breceives?\s+(?:the\s+)?Will\b",
            r"\bmasters?\b",
            r"\bunlocks?\b",
            r"\bawakens?\b",
            r"\badvances?\s+to\s+Class\b",
            r"\bpromoted\b",
            r"\bbreaks?\s+through\b",
            r"\bFoundation\s+(?:lesson|form)\b",
        )
    ),
}

# Skip any sentence matching this pattern when scanning for `death`, so that
# recap phrasing ("remembers Cian's death", "news of Feriun's death") doesn't
# fire a new death marker.
DEATH_RECAP = re.compile(
    r"\b(?:remember(?:s|ing|ed)?|recall(?:s|ing|ed)?|"
    r"news\s+of|word\s+of|learns?\s+of|learned\s+of|hears?\s+of|"
    r"mourns?|mourning|already\s+dead|"
    r"\w+'s\s+(?:death|funeral|murder)|"
    r"the\s+death\s+of)\b",
    re.IGNORECASE,
)

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _sentences(text: str) -> list[str]:
    text = text.replace("\n", " ").strip()
    if not text:
        return []
    return [s.strip() for s in SENTENCE_SPLIT.split(text) if s.strip()]


def _trim_label(sentence: str, max_len: int = 160) -> str:
    s = re.sub(r"\s+", " ", sentence).strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "\u2026"


def normalize_worlds(worlds: list[str], chapter_label: str) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for w in worlds:
        if w not in VALID_WORLDS:
            raise ValueError(
                f"tsotf-worlds.json: chapter {chapter_label!r} has invalid world "
                f"{w!r}. Allowed: {sorted(VALID_WORLDS)}"
            )
        if w not in seen:
            cleaned.append(w)
            seen.add(w)
    if not cleaned:
        # An empty list would remove the strand entirely; keep Res as a safe default.
        print(
            f"  warn: chapter {chapter_label!r} has empty worlds; defaulting to ['Res']",
            file=sys.stderr,
        )
        cleaned = ["Res"]
    cleaned.sort(key=lambda w: WORLD_ORDER[w])
    return cleaned


def load_tsotf_worlds() -> dict[int, list[str]]:
    if not TSOTF_WORLDS_PATH.exists():
        raise FileNotFoundError(
            f"Missing {TSOTF_WORLDS_PATH.relative_to(ROOT)}. Seed it with one "
            "entry per TSOTF chapter."
        )
    with TSOTF_WORLDS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    out: dict[int, list[str]] = {}
    for entry in data.get("chapters", []):
        idx = int(entry["index"])
        label = entry.get("label", str(idx))
        out[idx] = normalize_worlds(list(entry.get("worlds", [])), label)
    return out


def detect_annotations(overview: str, summary: str) -> list[dict[str, str]]:
    """Scan overview sentences first (tighter, self-contained), then fall
    back to summary sentences for types that didn't fire in the overview.
    Labels pulled from the overview tend to read cleaner than mid-paragraph
    summary fragments."""
    results: list[dict[str, str]] = []
    used_types: set[str] = set()

    for source in (overview, summary):
        for sent in _sentences(source):
            for ann_type, patterns in ANNOTATION_PATTERNS.items():
                if ann_type in used_types or not patterns:
                    continue
                if ann_type == "death" and DEATH_RECAP.search(sent):
                    continue
                for pat in patterns:
                    if pat.search(sent):
                        results.append({"type": ann_type, "label": _trim_label(sent)})
                        used_types.add(ann_type)
                        break

    return results


def load_book(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    chapters = data.get("chapters", [])
    return sorted(chapters, key=lambda c: c.get("index", 0))


def build() -> dict:
    twotm = load_book(TWOTM_PATH)
    tsotf = load_book(TSOTF_PATH)
    tsotf_worlds = load_tsotf_worlds()

    out_chapters: list[dict] = []
    series_index = 0

    # Book I: always Res. Annotations extracted from text.
    for ch in twotm:
        series_index += 1
        overview = ch.get("overview", "")
        summary = ch.get("summary", "")
        out_chapters.append(
            {
                "seriesIndex": series_index,
                "book": "twotm",
                "indexInBook": int(ch.get("index", series_index)),
                "label": ch.get("label", f"Chapter {series_index}"),
                "worlds": ["Res"],
                "annotations": detect_annotations(overview, summary),
            }
        )

    # Book II: worlds come from the hand-authored overrides file.
    missing: list[int] = []
    for ch in tsotf:
        series_index += 1
        idx = int(ch.get("index", series_index))
        overview = ch.get("overview", "")
        summary = ch.get("summary", "")
        if idx in tsotf_worlds:
            worlds = tsotf_worlds[idx]
        else:
            missing.append(idx)
            worlds = ["Res"]
        out_chapters.append(
            {
                "seriesIndex": series_index,
                "book": "tsotf",
                "indexInBook": idx,
                "label": ch.get("label", f"Chapter {series_index}"),
                "worlds": worlds,
                "annotations": detect_annotations(overview, summary),
            }
        )

    if missing:
        print(
            f"  warn: {len(missing)} TSOTF chapter(s) missing from "
            f"tsotf-worlds.json (defaulted to ['Res']): {missing}",
            file=sys.stderr,
        )

    return {"version": 2, "chapters": out_chapters}


def main() -> None:
    series = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(series, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Wrote {OUT_PATH.relative_to(ROOT)} ({len(series['chapters'])} chapters)")


if __name__ == "__main__":
    main()
