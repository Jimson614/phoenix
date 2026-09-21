import { describe, expect, it } from "vitest";
import { MIN_TASKS_FOR_PROGRESS, independentSolveProgress } from "./progress";
import { calculateAoyuStage } from "./stage";

describe("independent solve rate as global progress", () => {
  it("is the rounded share of tasks solved with no hint", () => {
    expect(independentSolveProgress(2, 5)).toBe(40);
    expect(independentSolveProgress(5, 5)).toBe(100);
    expect(independentSolveProgress(0, 5)).toBe(0);
  });

  it("rounds to the integer the stage contract requires", () => {
    expect(independentSolveProgress(1, 6)).toBe(17);
    expect(Number.isInteger(independentSolveProgress(1, 6))).toBe(true);
  });

  it("reaches CHENGLIN 42 through a real ratio rather than a constant", () => {
    const progress = independentSolveProgress(21, 50);
    expect(progress).toBe(42);
    expect(calculateAoyuStage(progress!)).toMatchObject({ stage: "CHENGLIN", label: "成鳞" });
  });

  it.each([0, 1, 2, 3, 4])("names no stage from only %s tasks", (total) => {
    expect(total).toBeLessThan(MIN_TASKS_FOR_PROGRESS);
    expect(independentSolveProgress(total, total)).toBeNull();
  });

  it("does not let a single unaided task read as a fully grown Aoyu", () => {
    expect(independentSolveProgress(1, 1)).toBeNull();
  });

  it.each([
    [-1, 5],
    [6, 5],
    [1.5, 5],
    [1, 5.5],
    [1, -5],
    [Number.NaN, 5],
  ])("returns null instead of inventing progress for (%s, %s)", (independent, total) => {
    expect(independentSolveProgress(independent, total)).toBeNull();
  });
});
