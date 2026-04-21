import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AnnotationType,
  ChapterPoint,
  WorldId,
} from "../types";

const VB_W = 1600;
const VB_H = 900;
const PAD_L = 132;
const PAD_R = 120;
const ANNOT_BAND_H = 130;
const AXIS_BAND_H = 72;
const PLOT_TOP = ANNOT_BAND_H;
const PLOT_BOTTOM = VB_H - AXIS_BAND_H;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;

// Right-side gutter where the LUCEUM / RES / OBITEUM track labels live.
const LABEL_GUTTER_X = VB_W - PAD_R + 10;
const LABEL_TICK_X1 = VB_W - PAD_R + 2;
const LABEL_TICK_X2 = VB_W - PAD_R + 8;

// Left-side RES label (Book I only has the Res track, so just one label here).
const LEFT_LABEL_TICK_X1 = PAD_L - 2;
const LEFT_LABEL_TICK_X2 = PAD_L - 8;
const LEFT_LABEL_DOT_X = PAD_L - 13;
const LEFT_LABEL_TEXT_X = PAD_L - 18;

const INNER_W = VB_W - PAD_L - PAD_R;

const MIN_ZOOM = 1;
const MAX_ZOOM = 20;

const WORLD_ACCENT: Record<WorldId, string> = {
  Luceum: "#f0c674",
  Res: "#c8ccd4",
  Obiteum: "#7aa2f7",
};

const TRACK_Y: Record<WorldId, number> = {
  Luceum: PLOT_TOP + PLOT_H * 0.08,
  Res: PLOT_TOP + PLOT_H * 0.5,
  Obiteum: PLOT_TOP + PLOT_H * 0.92,
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
  death: "Major Death",
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

interface SegmentPair {
  /** Index of chapter A */
  i: number;
  /** Y on chapter A */
  y1: number;
  /** Y on chapter A+1 */
  y2: number;
}

function buildSegmentPairs(chapters: ChapterPoint[]): SegmentPair[] {
  const pairs: SegmentPair[] = [];
  const ys = chapterWorldYs(chapters);
  for (let i = 0; i < chapters.length - 1; i++) {
    const a = chapters[i];
    const b = chapters[i + 1];
    if (a.worlds.length === 0 || b.worlds.length === 0) continue;
    const pp = pairEndpoints(a.worlds, b.worlds);
    for (const [ai, bi] of pp) {
      pairs.push({ i, y1: ys[i][ai], y2: ys[i + 1][bi] });
    }
  }
  return pairs;
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function WorldLineChart({ chapters }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startPan: number;
    moved: boolean;
  } | null>(null);

  // Max pan in svg user-units. Clamp panOffset whenever zoom decreases.
  const maxPan = INNER_W * (zoom - 1);
  useEffect(() => {
    setPanOffset((p) => clamp(p, 0, INNER_W * (zoom - 1)));
  }, [zoom]);

  // Static chapter geometry (independent of zoom/pan).
  const staticData = useMemo(() => {
    const segmentPairs = buildSegmentPairs(chapters);
    const topYs = chapters.map(topStrandY);
    const forkIdx = chapters.findIndex((c) => c.book === "tsotf");

    const annotationSpecs: {
      chapterIdx: number;
      annotationIdx: number;
      markerY: number;
      tickY: number;
      color: string;
      label: string;
      type: AnnotationType;
    }[] = [];
    chapters.forEach((ch, ci) => {
      ch.annotations.forEach((ann, ai) => {
        annotationSpecs.push({
          chapterIdx: ci,
          annotationIdx: ai,
          markerY: ANNOT_ROW_Y[ann.type],
          tickY: topYs[ci],
          color: ANNOT_COLORS[ann.type],
          label: ann.label,
          type: ann.type,
        });
      });
    });

    return { segmentPairs, forkIdx, annotationSpecs };
  }, [chapters]);

  // xFor depends on zoom + pan.
  const xFor = useCallback(
    (i: number) => {
      const n = chapters.length;
      const step = n > 1 ? (INNER_W * zoom) / (n - 1) : 0;
      return PAD_L + step * i - panOffset;
    },
    [chapters.length, zoom, panOffset]
  );

  const geometry = useMemo(() => {
    const { segmentPairs, forkIdx, annotationSpecs } = staticData;
    const segments: Segment[] = segmentPairs.map((p) => ({
      x1: xFor(p.i),
      y1: p.y1,
      x2: xFor(p.i + 1),
      y2: p.y2,
    }));
    const forkX =
      forkIdx > 0 ? (xFor(forkIdx - 1) + xFor(forkIdx)) / 2 : xFor(0);
    const annotations = annotationSpecs.map((a) => ({
      ...a,
      x: xFor(a.chapterIdx),
    }));
    return { segments, forkX, forkIdx, annotations };
  }, [staticData, xFor]);

  const { segments, forkX, forkIdx, annotations } = geometry;

  // Book ranges (inclusive chapter indices).
  const bookI = { start: 0, end: forkIdx > 0 ? forkIdx - 1 : chapters.length - 1 };
  const bookII = { start: forkIdx > 0 ? forkIdx : 0, end: chapters.length - 1 };

  // Determine which (if any) book the current view exactly matches, for
  // highlighting the active book-title button.
  const activeBook: "I" | "II" | null = (() => {
    const n = chapters.length;
    if (n < 2) return null;
    const step = (INNER_W * zoom) / (n - 1);
    if (step <= 0) return null;
    const visStart = panOffset / step;
    const visEnd = (panOffset + INNER_W) / step;
    const tol = 0.25;
    if (
      Math.abs(visStart - bookI.start) < tol &&
      Math.abs(visEnd - bookI.end) < tol
    )
      return "I";
    if (
      Math.abs(visStart - bookII.start) < tol &&
      Math.abs(visEnd - bookII.end) < tol
    )
      return "II";
    return null;
  })();

  // Fixed x positions for book-title buttons — always visible, proportional to
  // each book's share of the total chapter count.
  const bookILabelX =
    PAD_L + ((bookI.start + bookI.end + 1) / (2 * chapters.length)) * INNER_W;
  const bookIILabelX =
    PAD_L + ((bookII.start + bookII.end + 1) / (2 * chapters.length)) * INNER_W;

  const hoveredAnnotation = hover
    ? chapters[hover.chapterIdx].annotations[hover.annotationIdx]
    : null;
  const hoveredChapter = hover ? chapters[hover.chapterIdx] : null;

  // Convert a client-x coordinate to svg user-units (viewBox x).
  const clientXToSvgX = useCallback((clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return clientX;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return clientX;
    return ((clientX - rect.left) * VB_W) / rect.width;
  }, []);

  const zoomAtSvgX = useCallback(
    (svgX: number, factor: number) => {
      setZoom((oldZoom) => {
        const newZoom = clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (newZoom === oldZoom) return oldZoom;
        setPanOffset((oldPan) => {
          // Keep the content point under svgX anchored.
          const pivot = clamp(svgX, PAD_L, VB_W - PAD_R);
          const contentX = pivot - PAD_L + oldPan;
          const scale = newZoom / oldZoom;
          const newContentX = contentX * scale;
          const newPan = newContentX - (pivot - PAD_L);
          return clamp(newPan, 0, INNER_W * (newZoom - 1));
        });
        return newZoom;
      });
    },
    []
  );

  // Wheel: ctrl/meta or deltaY-dominant = zoom; deltaX or shift = pan.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      const horizontalIntent =
        e.shiftKey ||
        (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY));
      e.preventDefault();
      if (horizontalIntent) {
        const delta = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        setPanOffset((p) =>
          clamp(p + delta * 1.2, 0, INNER_W * (zoom - 1))
        );
      } else {
        const svgX = clientXToSvgX(e.clientX);
        // Normalize across mouse / trackpad.
        const factor = Math.exp(-e.deltaY * 0.0018);
        zoomAtSvgX(svgX, factor);
      }
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => {
      svg.removeEventListener("wheel", handler);
    };
  }, [clientXToSvgX, zoomAtSvgX, zoom]);

  // Drag-to-pan.
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (zoom <= 1) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startPan: panOffset,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const dxClient = e.clientX - drag.startClientX;
    if (Math.abs(dxClient) > 3) drag.moved = true;
    const dxSvg = (dxClient * VB_W) / rect.width;
    setPanOffset(clamp(drag.startPan - dxSvg, 0, INNER_W * (zoom - 1)));
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    try {
      svg?.releasePointerCapture(drag.pointerId);
    } catch {
      // ignore
    }
    dragRef.current = null;
    // Prevent click-through on the annotation under the cursor after a real drag.
    if (drag.moved) {
      e.preventDefault();
    }
  };

  const resetView = () => {
    setZoom(1);
    setPanOffset(0);
  };
  const zoomIn = () => zoomAtSvgX(VB_W / 2, 1.4);
  const zoomOut = () => zoomAtSvgX(VB_W / 2, 1 / 1.4);

  // Snap the view so that chapters [i1..i2] exactly span the plot width.
  const fitRange = useCallback(
    (i1: number, i2: number) => {
      const n = chapters.length;
      if (n < 2 || i2 <= i1) return;
      const span = i2 - i1;
      const newZoom = clamp((n - 1) / span, MIN_ZOOM, MAX_ZOOM);
      const step = (INNER_W * newZoom) / (n - 1);
      const newPan = clamp(step * i1, 0, INNER_W * (newZoom - 1));
      setZoom(newZoom);
      setPanOffset(newPan);
    },
    [chapters.length]
  );

  const isZoomed = zoom > 1.001;
  const dragging = dragRef.current != null;

  // Scrollbar thumb geometry (percentages of the track).
  const thumbWidthPct = 100 / zoom;
  const panFrac = maxPan > 0 ? panOffset / maxPan : 0;
  const thumbLeftPct = panFrac * (100 - thumbWidthPct);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startPanFrac: number;
    trackPx: number;
  } | null>(null);

  const onThumbPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    thumbDragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startPanFrac: panFrac,
      trackPx: track.getBoundingClientRect().width,
    };
  };

  const onThumbPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = thumbDragRef.current;
    if (!d) return;
    const available = d.trackPx * (1 - thumbWidthPct / 100);
    if (available <= 0) return;
    const dx = e.clientX - d.startClientX;
    const newFrac = clamp(d.startPanFrac + dx / available, 0, 1);
    setPanOffset(newFrac * INNER_W * (zoom - 1));
  };

  const onThumbPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = thumbDragRef.current;
    if (!d) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(d.pointerId);
    } catch {
      // ignore
    }
    thumbDragRef.current = null;
  };

  // Click on the scrollbar track to page the view.
  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const clickPct = ((e.clientX - rect.left) / rect.width) * 100;
    // Determine if click is before or after the thumb.
    const thumbCenter = thumbLeftPct + thumbWidthPct / 2;
    const direction = clickPct < thumbCenter ? -1 : 1;
    const pageFrac = thumbWidthPct / 100; // one viewport width
    const currentFrac = panFrac;
    const next = clamp(currentFrac + direction * pageFrac, 0, 1);
    setPanOffset(next * INNER_W * (zoom - 1));
  };

  return (
    <div className="chart-wrap">
      <div className="chart-controls" role="toolbar" aria-label="Timeline zoom">
        <button
          type="button"
          className="chart-ctrl-btn"
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM + 0.001}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <span className="chart-zoom-indicator" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="chart-ctrl-btn"
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM - 0.001}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="chart-ctrl-btn chart-ctrl-reset"
          onClick={resetView}
          disabled={!isZoomed && panOffset === 0}
          aria-label="Reset view"
          title="Reset view"
        >
          Reset
        </button>
      </div>

      <svg
        ref={svgRef}
        className={`world-line-chart${isZoomed ? " is-zoomed" : ""}${
          dragging ? " is-dragging" : ""
        }`}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Novel world-line chart"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <clipPath id="plot-clip">
            <rect x={PAD_L} y={0} width={INNER_W} height={VB_H} />
          </clipPath>
          {/* Soft vertical glow for the book-boundary separator. */}
          <linearGradient id="book-divider-glow" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--boundary-tsotf)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--boundary-tsotf)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--boundary-tsotf)" stopOpacity="0" />
          </linearGradient>
          {/* Vertical fade so the separator softens at the top and bottom. */}
          <linearGradient id="book-divider-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity="0" />
            <stop offset="18%" stopColor="#000" stopOpacity="1" />
            <stop offset="82%" stopColor="#000" stopOpacity="1" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <mask id="book-divider-mask">
            <rect
              x={0}
              y={PLOT_TOP - 20}
              width={VB_W}
              height={PLOT_H + 40}
              fill="url(#book-divider-fade)"
            />
          </mask>
        </defs>

        {/* Annotation row guides + labels (one row per annotation type).
            These stay fixed regardless of zoom/pan. */}
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
              y={ANNOT_ROW_Y[t] + 4}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize={12}
              letterSpacing="0.06em"
            >
              {ANNOT_LABELS[t].toUpperCase()}
            </text>
          </g>
        ))}

        {/* Everything inside the plot region is zoom/pan-aware and clipped. */}
        <g clipPath="url(#plot-clip)">
          {/* Track guides (TSOTF region) */}
          {WORLD_ORDER.map((world) => (
            <line
              key={`guide-${world}`}
              x1={forkX}
              x2={VB_W - PAD_R}
              y1={TRACK_Y[world]}
              y2={TRACK_Y[world]}
              stroke="var(--axis-grid)"
              strokeWidth={1}
              strokeDasharray="3 5"
            />
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

          {/* Book divider — a soft glow band that fades at top and bottom so
              the boundary reads as a subtle separator rather than a busy
              dashed line. A thin 1px core keeps it crisp. */}
          <g mask="url(#book-divider-mask)">
            <rect
              x={forkX - 8}
              y={PLOT_TOP - 20}
              width={16}
              height={PLOT_H + 40}
              fill="url(#book-divider-glow)"
              opacity={0.5}
            />
            <line
              x1={forkX}
              x2={forkX}
              y1={PLOT_TOP - 20}
              y2={PLOT_BOTTOM + 20}
              stroke="var(--boundary-tsotf)"
              strokeWidth={1}
              opacity={0.55}
            />
          </g>
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
              hover?.chapterIdx === a.chapterIdx &&
              hover?.annotationIdx === a.annotationIdx;
            return (
              <g
                key={`ann-${a.chapterIdx}-${a.annotationIdx}`}
                className="annotation"
                onMouseEnter={() => {
                  if (dragRef.current?.moved) return;
                  setHover({
                    chapterIdx: a.chapterIdx,
                    annotationIdx: a.annotationIdx,
                    x: a.x,
                    y: a.markerY,
                  });
                }}
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
                {/* Connector from the dot down to the strand. Only drawn on
                    hover/focus so the default view stays uncluttered. */}
                {isHovered ? (
                  <line
                    x1={a.x}
                    x2={a.x}
                    y1={a.markerY + 4}
                    y2={a.tickY}
                    stroke={a.color}
                    strokeWidth={1.6}
                    opacity={0.9}
                  />
                ) : null}
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

          {/* Axis bottom: show the first chapter of each book and every 5th
              chapter within that book. */}
          {chapters.map((_ch, i) => {
            const bookLocal =
              forkIdx > 0 && i >= forkIdx ? i - forkIdx + 1 : i + 1;
            const show = bookLocal === 1 || bookLocal % 5 === 0;
            if (!show) return null;
            const xi = xFor(i);
            if (xi < PAD_L - 1 || xi > VB_W - PAD_R + 1) return null;
            return (
              <g key={`tick-${i}`}>
                <line
                  x1={xi}
                  x2={xi}
                  y1={PLOT_BOTTOM}
                  y2={PLOT_BOTTOM + 4}
                  stroke="var(--axis-tick)"
                  strokeWidth={1}
                />
                <text
                  x={xi}
                  y={PLOT_BOTTOM + 16}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize={12}
                >
                  {bookLocal}
                </text>
              </g>
            );
          })}
        </g>

        {/* Left-side RES label mirrors the right-side gutter for Book I's single track */}
        <g className="world-labels">
          <line
            x1={LEFT_LABEL_TICK_X1}
            x2={LEFT_LABEL_TICK_X2}
            y1={TRACK_Y.Res}
            y2={TRACK_Y.Res}
            stroke={WORLD_ACCENT.Res}
            strokeWidth={1.5}
            opacity={0.85}
          />
          <circle
            cx={LEFT_LABEL_DOT_X}
            cy={TRACK_Y.Res}
            r={3}
            fill={WORLD_ACCENT.Res}
          />
          <text
            x={LEFT_LABEL_TEXT_X}
            y={TRACK_Y.Res + 4}
            className="world-label"
            textAnchor="end"
            fill="var(--text)"
            fontSize={12}
            fontWeight={600}
            letterSpacing="0.1em"
          >
            RES
          </text>
        </g>

        {/* Right-side world track labels */}
        <g className="world-labels">
          {WORLD_ORDER.map((world) => (
            <g key={`world-label-${world}`}>
              <line
                x1={LABEL_TICK_X1}
                x2={LABEL_TICK_X2}
                y1={TRACK_Y[world]}
                y2={TRACK_Y[world]}
                stroke={WORLD_ACCENT[world]}
                strokeWidth={1.5}
                opacity={0.85}
              />
              <circle
                cx={LABEL_TICK_X2 + 5}
                cy={TRACK_Y[world]}
                r={3}
                fill={WORLD_ACCENT[world]}
              />
              <text
                x={LABEL_GUTTER_X + 8}
                y={TRACK_Y[world] + 4}
                className="world-label"
                fill="var(--text)"
                fontSize={12}
                fontWeight={600}
                letterSpacing="0.1em"
              >
                {world.toUpperCase()}
              </text>
            </g>
          ))}
        </g>

        {/* Book-title buttons. Click to snap the view to that book's chapters.
            Positioned outside the plot clip so they stay visible at any zoom. */}
        <g className="book-labels">
          {([
            { id: "I", x: bookILabelX, text: "BOOK I — THE WILL OF THE MANY", range: bookI },
            { id: "II", x: bookIILabelX, text: "BOOK II — THE STRENGTH OF THE FEW", range: bookII },
          ] as const).map((b) => (
            <g
              key={`book-label-${b.id}`}
              className={`book-label${activeBook === b.id ? " is-active" : ""}`}
              onPointerDown={(e) => {
                // Prevent the svg-level drag-to-pan handler from capturing the
                // pointer; otherwise the subsequent click never reaches us.
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                fitRange(b.range.start, b.range.end);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fitRange(b.range.start, b.range.end);
                }
              }}
              aria-label={`Fit ${b.text} to view`}
            >
              <text
                x={b.x}
                y={PLOT_BOTTOM + 42}
                textAnchor="middle"
                fontSize={13}
                letterSpacing="0.08em"
              >
                {b.text}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {isZoomed ? (
        <div
          className="chart-scrollbar"
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          role="scrollbar"
          aria-controls="world-line-chart"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(panFrac * 100)}
        >
          <div
            className="chart-scrollbar-thumb"
            style={{
              left: `${thumbLeftPct}%`,
              width: `${thumbWidthPct}%`,
            }}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
          />
        </div>
      ) : null}

      {hover && hoveredAnnotation && hoveredChapter ? (
        (() => {
          // Flip tooltip below the marker when the marker is high in the annotation
          // band (tooltip would otherwise be clipped off the top of the page).
          const flipBelow = hover.y < ANNOT_BAND_H;
          // Shift tooltip leftward / rightward when near a horizontal edge so
          // the entire tooltip stays within the chart container.
          const xFrac = hover.x / VB_W;
          const translateX =
            xFrac > 0.78
              ? "calc(-100% + 16px)"
              : xFrac < 0.12
                ? "-16px"
                : "-50%";
          const translateY = flipBelow ? "14px" : "calc(-100% - 10px)";
          // Hide tooltip when its anchor has been panned out of the visible plot.
          const anchorVisible =
            hover.x >= PAD_L - 4 && hover.x <= VB_W - PAD_R + 4;
          if (!anchorVisible) return null;
          return (
            <div
              className="chart-tooltip"
              style={{
                left: `${xFrac * 100}%`,
                top: `${(hover.y / VB_H) * 100}%`,
                transform: `translate(${translateX}, ${translateY})`,
              }}
              role="status"
            >
              <div className="tooltip-type" style={{ color: ANNOT_COLORS[hoveredAnnotation.type] }}>
                {ANNOT_LABELS[hoveredAnnotation.type]}
              </div>
              <div className="tooltip-chapter">
                {hoveredChapter.book === "twotm" ? "TWOTM" : "TSOTF"} · {hoveredChapter.label}
                {hoveredChapter.book === "tsotf" && hoveredChapter.worlds.length > 0
                  ? ` · ${hoveredChapter.worlds.join(" / ")}`
                  : ""}
              </div>
              <div className="tooltip-label">{hoveredAnnotation.label}</div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
