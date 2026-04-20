import seriesData from "../content/viz/series.json";
import { WorldLineChart } from "./components/WorldLineChart";
import type { Series } from "./types";
import "./App.css";

const SERIES = seriesData as Series;

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Hierarchy Series</h1>
        <p className="subtitle">
          A single line traces each chapter's world. Book I holds a flat Res course; Book II opens
          three tracks — Luceum, Res, Obiteum — and the line splits and rejoins as the story moves
          between them. Markers above the chart flag deaths, reveals, alliances and betrayals,
          action beats, and breakthroughs.
        </p>
      </header>

      <WorldLineChart chapters={SERIES.chapters} />
    </div>
  );
}
