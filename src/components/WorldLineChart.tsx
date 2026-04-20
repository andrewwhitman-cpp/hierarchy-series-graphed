import { useMemo, useState } from "react";
import type {
  AnnotationType,
  ChapterPoint,
  WorldId,
} from "../types";

const VB_W = 1240;
const VB_H = 500;
const PAD_L = 128;
const PAD_R = 24;
const ANNOT_BAND_H = 108;
const AXIS_BAND_H = 56;
const PLOT_TOP = ANNOT_BAND_H;
const PLOT_BOTTOM = VB_H - AXIS_BAND_H;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;

const TRACK_Y: Record<WorldId, number> = {
  Luceum: PLOT_TOP + PLOT_H * 0.2,
  Res: PLOT_TOP + PLOT_H * 0.5,
  Obiteum: PLOT_TOP + PLOT_H * 0.8,
};

const WORLD_ORDER: WorldId[] = ["Luceum", "Res", "Obiteum"];

const ANNOT_COLORS: Record<AnnotationType, string> = {
  death: "#f7768e",
  breakthrough: "#9ece6a",
  reveal: "#f0c674",
  ally_or_betrayal: "#7dcfff",
  action: "#ff9e64",
};

const ANNOT_LABELS: Record<AnnotationType, string> = {
  death: "Death",
  breakthrough: "Breakthrough",
  reveal: "Reveal",
  ally_or_betrayal: "Ally / betrayal",
  action: "Action",
};

// Row order (top -> bottom) for annotation markers. Same-type markers all sit
// on the same horizontal line, so scanning for every "Death" (etc.) is a
// single-row sweep.
const ANNOT_ROW_ORDER: AnnotationType[] = [
  "death",
  "ally_or_betrayal",
  "breakthrough",
  "action",
  "reveal",
];

const ANNOT_ROW_STEP = 14;
const ANNOT_ROW_TOP = 14;
const ANNOT_ROW_Y: Record<AnnotationType, number> = Object.fromEntries(
  ANNOT_ROW_ORDER.map((t, i) => [t, ANNOT_ROW_TOP + i * ANNOT_ROW_STEP])
) as Record<AnnotationType, number>;

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

function yForWorld(book: "twotm" | "tsotf", world: WorldId): number {
  if (book === "twotm") return TRACK_Y.Res;
  return TRACK_Y[world];
}

/** For each chapter, the Y position of each actual world it inhabits. */
function chapterWorldYs(chapters: ChapterPoint[]): number[][] {
  return chapters.map((ch) => ch.worlds.map((w) => yForWorld(ch.book, w)));
}

/**
 * Pair endpoints of chapter A with endpoints of chapter B so the line moves
 * between tracks rather than running a ghost strand on a world that isn't
 * in the chapter. Rules:
 *   1. Identity matches (same world in A and B) pair first.
 *   2. Unmatched A endpoints merge into whichever B endpoint is nearest in Y.
 *   3. Unmatched B endpoints emerge from whichever A endpoint is nearest in Y.
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

  const aYs = aWorlds.map((w) => TRACK_Y[w]);
  const bYs = bWorlds.map((w) => TRACK_Y[w]);

  aWorlds.forEach((_w, ai) => {
    if (matchedA.has(ai)) return;
    let bestBi = 0;
    let bestDist = Infinity;
    bYs.forEach((by, bi) => {
      const d = Math.abs(aYs[ai] - by);
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
    aYs.forEach((ay, ai) => {
      const d = Math.abs(ay - bYs[bi]);
      if (d < bestDist) {
        bestDist = d;
        bestAi = ai;
      }
    });
    pairs.push([bestAi, bi]);
  });

  return pairs;
}

function buildSegments(chapters: ChapterPoint[], xFor: (i: number) => number): Segment[] {
  const segments: Segment[] = [];
  const ys = chapterWorldYs(chapters);
  for (let i = 0; i < chapters.length - 1; i++) {
    const a = chapters[i];
    const b = chapters[i + 1];
    if (a.worlds.length === 0 || b.worlds.length === 0) continue;
    const x1 = xFor(i);
    const x2 = xFor(i + 1);
    const pairs = pairEndpoints(a.worlds, b.worlds);
    for (const [ai, bi] of pairs) {
      segments.push({ x1, y1: ys[i][ai], x2, y2: ys[i + 1][bi] });
    }
  }
  return segments;
}

function segmentPath(s: Segment): string {
  const mx = (s.x1 + s.x2) / 2;
  return `M ${s.x1} ${s.y1} C ${mx} ${s.y1}, ${mx} ${s.y2}, ${s.x2} ${s.y2}`;
}

/** Y of the top-most (smallest Y) strand present at this chapter. Used to
 *  anchor the annotation tick line to the actual line. */
function topStrandY(chapter: ChapterPoint): number {
  if (chapter.worlds.length === 0) return TRACK_Y.Res;
  return Math.min(...chapter.worlds.map((w) => yForWorld(chapter.book, w)));
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
    const innerW = VB_W - PAD_L - PAD_R;
    const step = n > 1 ? innerW / (n - 1) : 0;
    const xFor = (i: number) => PAD_L + step * i;

    const segments = buildSegments(chapters, xFor);

    const forkIdx = chapters.findIndex((c) => c.book === "tsotf");
    const forkX = forkIdx > 0 ? (xFor(forkIdx - 1) + xFor(forkIdx)) / 2 : xFor(0);

    const annotations: {
      chapterIdx: number;
      annotationIdx: number;
      x: number;
      markerY: number;
      tickY: number;
      color: string;
      label: string;
      type: AnnotationType;
    }[] = [];

    chapters.forEach((ch, ci) => {
      ch.annotations.forEach((ann, ai) => {
        const x = xFor(ci);
        const tickY = topStrandY(ch);
        const markerY = ANNOT_ROW_Y[ann.type];
        annotations.push({
          chapterIdx: ci,
          annotationIdx: ai,
          x,
          markerY,
          tickY,
          color: ANNOT_COLORS[ann.type],
          label: ann.label,
          type: ann.type,
        });
      });
    });

    return { xFor, segments, forkX, forkIdx, annotations };
  }, [chapters]);

  const { segments, forkX, forkIdx, annotations, xFor } = geometry;

  const twotmLastX = forkIdx > 0 ? xFor(forkIdx - 1) : xFor(chapters.length - 1);

  const hoveredAnnotation = hover
    ? chapters[hover.chapterIdx].annotations[hover.annotationIdx]
    : null;
  const hoveredChapter = hover ? chapters[hover.chapterIdx] : null;

  return (
    <div className="chart-wrap">
      <svg
        className="world-line-chart"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="Novel world-line chart"
      >
        {/* Annotation row guides + labels (one row per annotation type) */}
        {ANNOT_ROW_ORDER.map((t) => (
          <g key={`annot-row-${t}`} className="annot-row">
            <line
              x1={PAD_L}
              x2={VB_W - PAD_R}
              y1={ANNOT_ROW_Y[t]}
              y2={ANNOT_ROW_Y[t]}
              stroke="var(--axis-grid)"
              strokeWidth={0.75}
              strokeDasharray="2 6"
              opacity={0.55}
            />
            <text
              x={PAD_L - 8}
              y={ANNOT_ROW_Y[t] + 3}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize={9.5}
              letterSpacing="0.06em"
            >
              {ANNOT_LABELS[t].toUpperCase()}
            </text>
          </g>
        ))}

        {/* Track guides (TSOTF region) */}
        {WORLD_ORDER.map((world) => (
          <g key={`guide-${world}`} className="track-guide">
            <line
              x1={forkX}
              x2={VB_W - PAD_R}
              y1={TRACK_Y[world]}
              y2={TRACK_Y[world]}
              stroke="var(--axis-grid)"
              strokeWidth={1}
              strokeDasharray="3 5"
            />
            <text
              x={forkX + 6}
              y={TRACK_Y[world] - 6}
              className="track-label"
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
          x1={PAD_L}
          x2={forkX}
          y1={TRACK_Y.Res}
          y2={TRACK_Y.Res}
          stroke="var(--axis-grid)"
          strokeWidth={1}
          strokeDasharray="3 5"
        />

        {/* Book divider */}
        <line
          x1={forkX}
          x2={forkX}
          y1={PLOT_TOP - 6}
          y2={PLOT_BOTTOM + 6}
          stroke="var(--boundary-tsotf)"
          strokeWidth={1.25}
          strokeDasharray="2 4"
          opacity={0.7}
        />
        <text
          x={(PAD_L + twotmLastX) / 2}
          y={PLOT_BOTTOM + 38}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize={11}
          letterSpacing="0.08em"
        >
          BOOK I — THE WILL OF THE MANY
        </text>
        <text
          x={(forkX + (VB_W - PAD_R)) / 2}
          y={PLOT_BOTTOM + 38}
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
          const isHovered = hover?.chapterIdx === a.chapterIdx && hover?.annotationIdx === a.annotationIdx;
          return (
            <g
              key={`ann-${a.chapterIdx}-${a.annotationIdx}`}
              className="annotation"
              onMouseEnter={() =>
                setHover({
                  chapterIdx: a.chapterIdx,
                  annotationIdx: a.annotationIdx,
                  x: a.x,
                  y: a.markerY,
                })
              }
              onMouseLeave={() => setHover(null)}
              onFocus={() =>
                setHover({
                  chapterIdx: a.chapterIdx,
                  annotationIdx: a.annotationIdx,
                  x: a.x,
                  y: a.markerY,
                })
              }
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${ANNOT_LABELS[a.type]}: ${a.label}`}
            >
              <line
                x1={a.x}
                x2={a.x}
                y1={a.markerY + 4}
                y2={a.tickY}
                stroke={a.color}
                strokeWidth={isHovered ? 1.6 : 0.6}
                opacity={isHovered ? 0.95 : 0.18}
              />
              <circle
                cx={a.x}
                cy={a.markerY}
                r={isHovered ? 5.5 : 4}
                fill={a.color}
                stroke="var(--bg)"
                strokeWidth={1.25}
              />
            </g>
          );
        })}

        {/* Axis bottom: sparse chapter ticks */}
        {chapters.map((_ch, i) => {
          const show = i === 0 || i === chapters.length - 1 || (i + 1) % 10 === 0 || i === forkIdx;
          if (!show) return null;
          return (
            <g key={`tick-${i}`}>
              <line
                x1={xFor(i)}
                x2={xFor(i)}
                y1={PLOT_BOTTOM}
                y2={PLOT_BOTTOM + 4}
                stroke="var(--axis-tick)"
                strokeWidth={1}
              />
              <text
                x={xFor(i)}
                y={PLOT_BOTTOM + 14}
                textAnchor="middle"
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
            top: `${(hover.y / VB_H) * 100}%`,
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
