import { describe, expect, it } from "vitest";
import { taskCompanionEvent, type TaskCompanionSnapshot } from "./aoyu-task-adapter";

const base: TaskCompanionSnapshot = { taskId: 7, sessionId: 9, solved: false,
  evidenceConfirmed: false, hintLevel: 0, attemptCount: 0 };
describe("persisted task adapter", () => {
  it("requires both solved session and confirmed evidence", () => {
    expect(taskCompanionEvent({ ...base, solved: true }).state).toBe("WAITING");
    expect(taskCompanionEvent({ ...base, evidenceConfirmed: true }).state).toBe("WAITING");
    expect(taskCompanionEvent({ ...base, solved: true, evidenceConfirmed: true }).state).toBe("CELEBRATE");
  });
  it("keeps the completion key stable after rerenders and changed attempts", () => {
    const completed = { ...base, solved: true, evidenceConfirmed: true };
    expect(taskCompanionEvent(completed)).toEqual(taskCompanionEvent({ ...completed, attemptCount: 8 }));
  });
  it.each([1, 2, 3])("maps persisted Hint %i", (hintLevel) => {
    expect(taskCompanionEvent({ ...base, hintLevel, attemptCount: 1 }).state).toBe("HINT");
  });
  it.each([0, 4, 5])("does not invent a Gate 1 Hint event for level %i", (hintLevel) => {
    expect(taskCompanionEvent({ ...base, hintLevel }).state).toBe("WAITING");
  });
});
