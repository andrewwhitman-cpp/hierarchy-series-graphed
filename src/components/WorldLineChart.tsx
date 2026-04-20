import { useMemo, useState } from "react";
import type {
  AnnotationType,
  ChapterPoint,
  WorldId,
} from "../types";

const VB_W = 800;
const PAD_T = 150;
const PAD_B = 56;
const CHAPTER_STEP = 8;

const STRAND_LEFT = 104;
const STRAND_W = 220;

const ANNOT_COL_START = 404;
const ANNOT_COL_STEP = 68;

const TRACK_X: Record<WorldId, number> = {
  Luceum: STRAND_LEFT + STRAND_W * 0.2,
  Res: STRAND_LEFT + STRAND_W * 0.5,
  Obiteum: STRAND_LEFT + STRAND_W * 0.8,
};

const WORLD_ORDER: WorldId[] = ["Luceum", "Res", "Obiteum"];

const ANNOT_COLORS: Record<AnnotationType, string> = {
  new_relationship: "#7dcfff",
  major_relationship_change: "#bb9af7",
  death: "#f7768e",
  major_event: "#f0c674",
  minor_event: "#8b919c",
};

const ANNOT_LABELS: Record<AnnotationType, string> = {
  new_relationship: "New relationship",
  major_relationship_change: "Relationship shift",
  death: "Death",
  major_event: "Major event",
  minor_event: "Minor event",
};

// Column order (left -> right) for annotation markers. Same-type markers all sit
// in the same vertical column, so scanning for every "Death" (etc.) is a
// single-column sweep.
const ANNOT_COL_ORDER: AnnotationType[] = [
  "new_relationship",
  "major_relationship_change",
  "death",
  "major_event",
  "minor_event",
];

const ANNOT_COL_X: Record<AnnotationType, number> = Object.fromEntries(
  ANNOT_COL_ORDER.map((t, i) => [t, ANNOT_COL_START + i * ANNOT_COL_STEP])
) as Record<AnnotationType, number>;

const LAST_COL_X = ANNOT_COL_X[ANNOT_COL_ORDER[ANNOT_COL_ORDER.length - 1]];

const STRAND_COLOR = "#e8eaef";
const STRAND_WIDTH = 1.75;

interface Props {
  chapters: ChapterPoint[];
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function xForWorld(book: "twotm" | "tsotf", world: WorldId): number {
  if (book === "twotm") return TRACK_X.Res;
  return TRACK_X[world];
}

/** For each chapter, the X position of each actual world it inhabits. */
function chapterWorldXs(chapters: ChapterPoint[]): number[][] {
  return chapters.map((ch) => ch.worlds.map((w) => xForWorld(ch.book, w)));
}

/**
 * Pair endpoints of chapter A with endpoints of chapter B so the strand moves
 * between tracks rather than running a ghost line on a world that isn't in
 * the chapter. Rules:
 *   1. Identity matches (same world in A and B) pair first.
 *   2. Unmatched A endpoints merge into whichever B endpoint is nearest in X.
 *   3. Unmatched B endpoints emerge from whichever A endpoint is nearest in X.
 */
function pairEndpoints(aWorlds: WorldId[], bWorlds: WorldId[]): [number, number][] {
  const pairs: [number, number][] = [];
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();

  aWorlds.forEach((w, ai) => {
    const bi = bWorlds.indexOf(w);
    if (bi !== -1 && !matchedB.has(bi)) {
      pairs.push([ai, bi]);
      matchedA.add(ai);
      matchedB.add(bi);
    }
  });

  const aXs = aWorlds.map((w) => TRACK_X[w]);
  const bXs = bWorlds.map((w) => TRACK_X[w]);

  aWorlds.forEach((_w, ai) => {
    if (matchedA.has(ai)) return;
    let bestBi = 0;
    let bestDist = Infinity;
    bXs.forEach((bx, bi) => {
      const d = Math.abs(aXs[ai] - bx);
      if (d < bestDist) {
        bestDist = d;
        bestBi = bi;
      }
    });
    pairs.push([ai, bestBi]);
  });

  bWorlds.forEach((_w, bi) => {
    if (matchedB.has(bi)) return;
    if (pairs.some((p) => p[1] === bi)) return;
    let bestAi = 0;
    let bestDist = Infinity;
    aXs.forEach((ax, ai) => {
      const d = Math.abs(ax - bXs[bi]);
      if (d < bestDist) {
        bestDist = d;
        bestAi = ai;
      }
    });
    pairs.push([bestAi, bi]);
  });

  return pairs;
}

function buildSegments(chapters: ChapterPoint[], yFor: (i: number) => number): Segment[] {
  const segments: Segment[] = [];
  const xs = chapterWorldXs(chapters);
  for (let i = 0; i < chapters.length - 1; i++) {
    const a = chapters[i];
    const b = chapters[i + 1];
    if (a.worlds.length === 0 || b.worlds.length === 0) continue;
    const y1 = yFor(i);
    const y2 = yFor(i + 1);
    const pairs = pairEndpoints(a.worlds, b.worlds);
    for (const [ai, bi] of pairs) {
      segments.push({ x1: xs[i][ai], y1, x2: xs[i + 1][bi], y2 });
    }
  }
  return segments;
}

function segmentPath(s: Segment): string {
  const my = (s.y1 + s.y2) / 2;
  return `M ${s.x1} ${s.y1} C ${s.x1} ${my}, ${s.x2} ${my}, ${s.x2} ${s.y2}`;
}

/** X of the right-most strand present at this chapter. Used to anchor the
 *  annotation tick line to the actual line. */
function rightmostStrandX(chapter: ChapterPoint): number {
  if (chapter.worlds.length === 0) return TRACK_X.Res;
  return Math.max(...chapter.worlds.map((w) => xForWorld(chapter.book, w)));
}

interface HoverState {
  chapterIdx: number;
  annotationIdx: number;
  x: number;
  y: number;
}

export function WorldLineChart({ chapters }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const geometry = useMemo(() => {
    const n = chapters.length;
    const vbH = PAD_T + CHAPTER_STEP * Math.max(n - 1, 0) + PAD_B;
    const yFor = (i: number) => PAD_T + CHAPTER_STEP * i;

    const segments = buildSegments(chapters, yFor);

    const forkIdx = chapters.findIndex((c) => c.book === "tsotf");
    const forkY = forkIdx > 0 ? (yFor(forkIdx - 1) + yFor(forkIdx)) / 2 : yFor(0);

    const annotations: {
      chapterIdx: number;
      annotationIdx: number;
      y: number;
      markerX: number;
      tickX: number;
      color: string;
      label: string;
      type: AnnotationType;
    }[] = [];

    chapters.forEach((ch, ci) => {
      ch.annotations.forEach((ann, ai) => {
        const y = yFor(ci);
        const tickX = rightmostStrandX(ch);
        const markerX = ANNOT_COL_X[ann.type];
        annotations.push({
          chapterIdx: ci,
          annotationIdx: ai,
          y,
          markerX,
          tickX,
          color: ANNOT_COLORS[ann.type],
          label: ann.label,
          type: ann.type,
        });
      });
    });

    return { yFor, segments, forkY, forkIdx, annotations, vbH };
  }, [chapters]);

  const { segments, forkY, forkIdx, annotations, yFor, vbH } = geometry;

  const twotmLastY = forkIdx > 0 ? yFor(forkIdx - 1) : yFor(chapters.length - 1);

  const hoveredAnnotation = hover
    ? chapters[hover.chapterIdx].annotations[hover.annotationIdx]
    : null;
  const hoveredChapter = hover ? chapters[hover.chapterIdx] : null;

  return (
    <div className="chart-wrap">
      <div className="chart-svg-wrap">
        <svg
          className="world-line-chart"
          viewBox={`0 0 ${VB_W} ${vbH}`}
          role="img"
          aria-label="Novel world-line chart"
        >
          {/* Annotation column guides + headers */}
          {ANNOT_COL_ORDER.map((t) => (
            <g key={`annot-col-${t}`} className="annot-col">
              <line
                x1={ANNOT_COL_X[t]}
                x2={ANNOT_COL_X[t]}
                y1={PAD_T}
                y2={vbH - PAD_B}
                stroke="var(--axis-grid)"
                strokeWidth={0.75}
                strokeDasharray="2 6"
                opacity={0.55}
              />
              <text
                x={ANNOT_COL_X[t]}
                y={PAD_T - 12}
                transform={`rotate(-45 ${ANNOT_COL_X[t]} ${PAD_T - 12})`}
                textAnchor="start"
                fill="var(--text-muted)"
                fontSize={9.5}
                letterSpacing="0.06em"
              >
                {ANNOT_LABELS[t].toUpperCase()}
              </text>
            </g>
          ))}

          {/* World track guides (TSOTF region) */}
          {WORLD_ORDER.map((world) => (
            <g key={`guide-${world}`} className="track-guide">
              <line
                x1={TRACK_X[world]}
                x2={TRACK_X[world]}
                y1={forkY}
                y2={vbH - PAD_B}
                stroke="var(--axis-grid)"
                strokeWidth={1}
                strokeDasharray="3 5"
              />
              <text
                x={TRACK_X[world]}
                y={forkY + 16}
                className="track-label"
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize={11}
                letterSpacing="0.06em"
              >
                {world.toUpperCase()}
              </text>
            </g>
          ))}

          {/* Single Res guide across TWOTM region */}
          <line
            x1={TRACK_X.Res}
            x2={TRACK_X.Res}
            y1={PAD_T}
            y2={forkY}
            stroke="var(--axis-grid)"
            strokeWidth={1}
            strokeDasharray="3 5"
          />

          {/* Book divider */}
          <line
            x1={STRAND_LEFT - 14}
            x2={LAST_COL_X + 14}
            y1={forkY}
            y2={forkY}
            stroke="var(--boundary-tsotf)"
            strokeWidth={1.25}
            strokeDasharray="2 4"
            opacity={0.7}
          />
          <text
            x={28}
            y={(PAD_T + twotmLastY) / 2}
            transform={`rotate(-90 28 ${(PAD_T + twotmLastY) / 2})`}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize={11}
            letterSpacing="0.08em"
          >
            BOOK I — THE WILL OF THE MANY
          </text>
          <text
            x={28}
            y={(forkY + (vbH - PAD_B)) / 2}
            transform={`rotate(-90 28 ${(forkY + (vbH - PAD_B)) / 2})`}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize={11}
            letterSpacing="0.08em"
          >
            BOOK II — THE STRENGTH OF THE FEW
          </text>

          {/* Strand segments: one cubic per adjacent-chapter endpoint pair */}
          <g className="strand-segments">
            {segments.map((s, idx) => (
              <path
                key={`seg-${idx}`}
                d={segmentPath(s)}
                fill="none"
                stroke={STRAND_COLOR}
                strokeWidth={STRAND_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.94}
              />
            ))}
          </g>

          {/* Annotation ticks + markers */}
          {annotations.map((a) => {
            const isHovered =
              hover?.chapterIdx === a.chapterIdx && hover?.annotationIdx === a.annotationIdx;
            return (
              <g
                key={`ann-${a.chapterIdx}-${a.annotationIdx}`}
                className="annotation"
                onMouseEnter={() =>
                  setHover({
                    chapterIdx: a.chapterIdx,
                    annotationIdx: a.annotationIdx,
                    x: a.markerX,
                    y: a.y,
                  })
                }
                onMouseLeave={() => setHover(null)}
                onFocus={() =>
                  setHover({
                    chapterIdx: a.chapterIdx,
                    annotationIdx: a.annotationIdx,
                    x: a.markerX,
                    y: a.y,
                  })
                }
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="button"
                aria-label={`${ANNOT_LABELS[a.type]}: ${a.label}`}
              >
                <line
                  x1={a.tickX}
                  x2={a.markerX - 4}
                  y1={a.y}
                  y2={a.y}
                  stroke={a.color}
                  strokeWidth={isHovered ? 1.6 : 0.6}
                  opacity={isHovered ? 0.95 : 0.18}
                />
                <circle
                  cx={a.markerX}
                  cy={a.y}
                  r={isHovered ? 5 : 3.6}
                  fill={a.color}
                  stroke="var(--bg)"
                  strokeWidth={1.25}
                />
                <title>{`${ANNOT_LABELS[a.type]} — ${chapters[a.chapterIdx].label}\n${a.label}`}</title>
              </g>
            );
          })}

          {/* Chapter ticks along the left */}
          {chapters.map((_ch, i) => {
            const show = i === 0 || i === chapters.length - 1 || (i + 1) % 10 === 0 || i === forkIdx;
            if (!show) return null;
            return (
              <g key={`tick-${i}`}>
                <line
                  x1={STRAND_LEFT - 6}
                  x2={STRAND_LEFT - 2}
                  y1={yFor(i)}
                  y2={yFor(i)}
                  stroke="var(--axis-tick)"
                  strokeWidth={1}
                />
                <text
                  x={STRAND_LEFT - 10}
                  y={yFor(i) + 3}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize={10}
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>

        {hover && hoveredAnnotation && hoveredChapter ? (
          <div
            className="chart-tooltip"
            style={{
              left: `${(hover.x / VB_W) * 100}%`,
              top: `${(hover.y / vbH) * 100}%`,
            }}
            role="status"
          >
            <div className="tooltip-type" style={{ color: ANNOT_COLORS[hoveredAnnotation.type] }}>
              {ANNOT_LABELS[hoveredAnnotation.type]}
            </div>
            <div className="tooltip-chapter">
              {hoveredChapter.book === "twotm" ? "TWOTM" : "TSOTF"} · {hoveredChapter.label}
            </div>
            <div className="tooltip-label">{hoveredAnnotation.label}</div>
          </div>
        ) : null}
      </div>

      <ul className="annot-legend" aria-label="Annotation types">
        {(Object.keys(ANNOT_LABELS) as AnnotationType[]).map((t) => (
          <li key={t} className="annot-legend-item">
            <span
              className="annot-legend-swatch"
              style={{ background: ANNOT_COLORS[t] }}
              aria-hidden="true"
            />
            {ANNOT_LABELS[t]}
          </li>
        ))}
      </ul>
    </div>
  );
}
