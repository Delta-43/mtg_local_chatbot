import { describe, expect, it } from "vitest";
import {
  collectRequestedWindow,
  createSearchWindowCollector,
} from "../src/services/search-window.js";

describe("collectRequestedWindow", () => {
  it("drops skipped cards before storing the requested slice", () => {
    const result = collectRequestedWindow(
      [
        { data: ["a", "b", "c", "d"], has_more: true, warnings: [] },
        { data: ["e", "f"], has_more: false, warnings: ["warn"] },
      ],
      2,
      3
    );

    expect(result.data).toEqual(["c", "d", "e"]);
    expect(result.warnings).toEqual(["warn"]);
  });
});

describe("createSearchWindowCollector", () => {
  it("collects the requested window incrementally and deduplicates warnings", () => {
    const collector = createSearchWindowCollector<number>(3, 4);

    collector.addPage({ data: [0, 1, 2, 3, 4], warnings: ["first"] });
    collector.addPage({ data: [5, 6, 7, 8, 9], warnings: ["first", "second"] });

    expect(collector.isComplete()).toBe(true);
    expect(collector.finish()).toEqual({
      data: [3, 4, 5, 6],
      warnings: ["first", "second"],
    });
  });
});
