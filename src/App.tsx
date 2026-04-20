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
          A chapter-by-chapter map of James Islington's Hierarchy series.
        </p>
      </header>

      <WorldLineChart chapters={SERIES.chapters} />
    </div>
  );
}
