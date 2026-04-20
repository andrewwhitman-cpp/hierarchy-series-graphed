export type BookId = "twotm" | "tsotf";

export type WorldId = "Res" | "Luceum" | "Obiteum";

export type AnnotationType =
  | "new_relationship"
  | "major_relationship_change"
  | "death"
  | "major_event"
  | "minor_event";

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
