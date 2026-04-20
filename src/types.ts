export type BookId = "twotm" | "tsotf";

export type WorldId = "Res" | "Luceum" | "Obiteum";

export type AnnotationType =
  | "death"
  | "reveal"
  | "ally_or_betrayal"
  | "action"
  | "breakthrough";

export interface ChapterAnnotation {
  type: AnnotationType;
  label: string;
}

export interface ChapterPoint {
  seriesIndex: number;
  book: BookId;
  indexInBook: number;
  label: string;
  worlds: WorldId[];
  annotations: ChapterAnnotation[];
}

export interface Series {
  version: number;
  chapters: ChapterPoint[];
}
