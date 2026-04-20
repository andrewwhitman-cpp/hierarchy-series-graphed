# SparknotesAI chapter data (import guide)

**Generated files (repo):**

- [`content/sparknotes/twotm-chapters.json`](../content/sparknotes/twotm-chapters.json) — 74 chapters (*The Will of the Many*)
- [`content/sparknotes/tsotf-chapters.json`](../content/sparknotes/tsotf-chapters.json) — 80 chapters (*The Strength of the Few*)
- [`content/sparknotes/series-index.json`](../content/sparknotes/series-index.json) — pointers + counts

**Regenerate:** `python3 scripts/fetch_sparknotes_chapters.py` (re-fetches from SparknotesAI; ~2–3 minutes, be polite to their servers).

This document records schema, warnings, and the same logic as the script for reference.

## Public viz dataset (spoiler-safe, shipped to the app)

The interactive site loads **`content/viz/public.series.json`** — abstract nodes, per-chapter edges, `worldPresence`, three strip metrics on a shared 0–1 scale (`momentum01`, `hope01` dread→hope, `mystery01`), **`spoilerOneLine`** (first sentence from Sparknotes `overview`, else `summary`), and `nodeBand` for layout. The UI hides **`spoilerOneLine`** behind an explicit spoiler control. JSON Schema: **`content/viz/public-series.schema.json`**.

**Placeholder math (default):** `python3 scripts/generate_public_series.py` — deterministic curves; **does not** read Sparknotes.

**LLM scores from Sparknotes text:** Shared builder logic lives in **`scripts/series_builder.py`**.

1. Install API client: `pip install -r scripts/requirements-llm.txt`
2. Set **`OPENAI_API_KEY`** (optional **`OPENAI_BASE_URL`**, **`OPENAI_MODEL`** — see **`.env.example`**).
3. Run **`python3 scripts/score_chapters_llm.py`** (calls the API per chapter; progress is cached in **`content/viz/.llm-scores-cache.jsonl`**, gitignored). Use **`--dry-run`** to write `llm-scores.json` with placeholder math only (no API).
4. Merge into the shipped file: **`python3 scripts/generate_public_series.py --from-llm content/viz/llm-scores.json`**

`llm-scores.json` is **gitignored** (regenerate locally after scoring). Commit the updated **`public.series.json`** when you are happy with the merged numbers.

Only **numeric scores** land in `public.series.json`; Sparknotes prose is **not** shipped in the app bundle. Summaries remain spoilery—keep scoring **offline**.

## Sources

| Book | SparknotesAI URL |
|------|------------------|
| *The Will of the Many* | https://www.sparknotesai.com/books/a9cb02cb-bf74-4d52-a8c0-d7eb02d1fee2 |
| *The Strength of the Few* | https://www.sparknotesai.com/books/357fa8b5-e438-4d0a-8147-d08aca1bf009 |

## Important warnings

- **Spoilers:** Per-chapter summaries are **full plot recap** level. Do **not** ship this text on a “no spoilers” public route without a separate, redacted `overviewSafe` field you author.
- **Copyright / terms:** Third-party summaries may be protected; use for **personal / portfolio** visualization authoring unless you have rights. Link back to SparknotesAI; do not replace their site.
- **Accuracy:** Content is AI-generated study material—verify against the novels for anything mission-critical.

## JSON shape (for the graph / site)

Each book file:

```json
{
  "bookId": "uuid",
  "title": "string",
  "author": "James Islington",
  "sourceBookUrl": "https://www.sparknotesai.com/books/…",
  "fetchedAt": "ISO-8601 UTC",
  "chapters": [
    {
      "index": 1,
      "label": "Chapter I or I",
      "sparknotesChapterId": "uuid",
      "sourceUrl": "https://www.sparknotesai.com/books/…/chapters/…",
      "overview": "plain text, short",
      "summary": "plain text, long"
    }
  ]
}
```

- **TWOTM** uses labels like `Chapter I` … `Chapter LXXIV` (74 story chapters; index also lists *Major Characters* / *Locations*—**skip** those slugs).
- **TSOTF** uses Roman numerals only (`I` … `LXXX`) for **80** chapters.

## Extraction approach

Chapter pages are server-rendered with:

- `<div class="chapter-overview">…</div>`
- `<div class="chapter-full_summary">…</div>`

Fetch each `…/books/{bookId}/chapters/{chapterUuid}` page, strip HTML to plain text, and write JSON.

## Script

Implementation: [`scripts/fetch_sparknotes_chapters.py`](../scripts/fetch_sparknotes_chapters.py)

```bash
python3 scripts/fetch_sparknotes_chapters.py
```

## Visualization mapping

The strip uses four abstract metrics above; **`worldPresence`** / **`nodeBand`** in `public.series.json` remain **placeholder** geometry unless you author replacements. Sparknotes text is the **input** for LLM or manual scoring, not something to paste verbatim into the UI.

---

## Verified sample (extracted from HTML)

*The Will of the Many*, **Chapter I** — fields below match what the script pulls from `chapter-overview` and `chapter-full_summary`.

**Overview**

Vis escorts a Governance agent, Sextus Hospius, to interrogate Sapper-bound prisoner Nateo, exposing the prison’s grim machinery and Vis’s need to remain unnoticed. The Vetusian exchange reveals a hidden connection and a search for clues about Caeror and an ancient "gate." Nateo’s desperate attack nearly exposes Vis’s unusual resistance to Sappers, prompting secrecy and payment. The encounter hints at a larger conspiracy while deepening Vis’s perilous position.

**Summary** (abbreviated in this doc only — full text is several paragraphs on Sparknotes)

The chapter opens with a traumatic memory, moves through Letens Prison and the Sapper interrogation, confirms Vis’s anomalous resistance to the Sapper, and ends with Vis returning toward the Theatre while hiding what he is.

---
