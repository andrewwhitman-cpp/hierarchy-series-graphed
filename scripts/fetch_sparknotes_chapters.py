#!/usr/bin/env python3
"""Regenerate content/sparknotes/*-chapters.json from SparknotesAI."""

from __future__ import annotations

import html as html_module
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "content" / "sparknotes"
UA = "Mozilla/5.0 (compatible; novel-graph/1.0)"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_block(page: str, class_name: str) -> str | None:
    m = re.search(
        rf'<div class="{re.escape(class_name)}">(.*?)</div>\s*<!-- HTML_TAG_END -->',
        page,
        re.DOTALL | re.IGNORECASE,
    )
    if not m:
        m = re.search(
            rf'<div class="{re.escape(class_name)}">(.*?)</div>',
            page,
            re.DOTALL | re.IGNORECASE,
        )
    return m.group(1).strip() if m else None


def html_to_text(fragment: str) -> str:
    if not fragment:
        return ""
    t = re.sub(r"</p>\s*<p>", "\n\n", fragment, flags=re.IGNORECASE)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.IGNORECASE)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html_module.unescape(t)
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()


def parse_chapter_links(book_id: str, index_html: str) -> list[tuple[str, str]]:
    pat = re.compile(
        rf'href="/books/{re.escape(book_id)}/chapters/([a-f0-9-]{{36}})"[^>]*>([^<]+)</a>',
        re.IGNORECASE,
    )
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for uuid, title in pat.findall(index_html):
        if uuid in seen:
            continue
        seen.add(uuid)
        t = title.strip()
        if t in ("Major Characters", "Locations"):
            continue
        out.append((uuid, t))
    return out


def process_book(book_id: str, title: str, source_url: str, delay_s: float = 0.22) -> dict:
    index_url = f"https://www.sparknotesai.com/books/{book_id}"
    index_html = fetch(index_url)
    links = parse_chapter_links(book_id, index_html)
    chapters: list[dict] = []
    for i, (ch_uuid, label) in enumerate(links, start=1):
        ch_url = f"{index_url}/chapters/{ch_uuid}"
        try:
            page = fetch(ch_url)
            ov = html_to_text(extract_block(page, "chapter-overview") or "")
            sm = html_to_text(extract_block(page, "chapter-full_summary") or "")
            chapters.append(
                {
                    "index": i,
                    "label": label,
                    "sparknotesChapterId": ch_uuid,
                    "sourceUrl": ch_url,
                    "overview": ov,
                    "summary": sm,
                }
            )
        except Exception as e:
            chapters.append(
                {
                    "index": i,
                    "label": label,
                    "sparknotesChapterId": ch_uuid,
                    "sourceUrl": ch_url,
                    "error": str(e),
                }
            )
        time.sleep(delay_s)

    return {
        "bookId": book_id,
        "title": title,
        "author": "James Islington",
        "sourceBookUrl": source_url,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "chapters": chapters,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    twotm = process_book(
        "a9cb02cb-bf74-4d52-a8c0-d7eb02d1fee2",
        "The Will of the Many",
        "https://www.sparknotesai.com/books/a9cb02cb-bf74-4d52-a8c0-d7eb02d1fee2",
    )
    tsotf = process_book(
        "357fa8b5-e438-4d0a-8147-d08aca1bf009",
        "The Strength of the Few",
        "https://www.sparknotesai.com/books/357fa8b5-e438-4d0a-8147-d08aca1bf009",
    )
    (OUT_DIR / "twotm-chapters.json").write_text(
        json.dumps(twotm, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "tsotf-chapters.json").write_text(
        json.dumps(tsotf, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "series-index.json").write_text(
        json.dumps(
            {
                "books": [
                    {
                        "slug": "twotm",
                        "title": twotm["title"],
                        "chapterCount": len(twotm["chapters"]),
                        "dataFile": "content/sparknotes/twotm-chapters.json",
                    },
                    {
                        "slug": "tsotf",
                        "title": tsotf["title"],
                        "chapterCount": len(tsotf["chapters"]),
                        "dataFile": "content/sparknotes/tsotf-chapters.json",
                    },
                ],
                "fetchedAt": twotm["fetchedAt"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print("Wrote JSON under", OUT_DIR)


if __name__ == "__main__":
    main()
