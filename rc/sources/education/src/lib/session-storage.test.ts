import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readSessionItem,
  removeSessionItems,
  shouldResetSessionForStart,
  writeSessionItem,
} from "@/lib/session-storage";

describe("safe session storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("reads, writes, and removes session values", () => {
    expect(writeSessionItem("test-key", "value")).toBe(true);
    expect(readSessionItem("test-key")).toBe("value");

    removeSessionItems(["test-key"]);
    expect(readSessionItem("test-key")).toBeNull();
  });

  it("does not throw when the browser blocks storage access", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(readSessionItem("test-key")).toBeNull();
    expect(writeSessionItem("test-key", "value")).toBe(false);
    expect(() => removeSessionItems(["test-key"])).not.toThrow();
  });

  it("continues clearing later values when one key cannot be removed", () => {
    sessionStorage.setItem("blocked-key", "stale");
    sessionStorage.setItem("clearable-key", "stale");
    const originalRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "blocked-key") throw new DOMException("blocked", "SecurityError");
      return originalRemoveItem.call(this, key);
    });

    removeSessionItems(["blocked-key", "clearable-key"]);

    expect(sessionStorage.getItem("blocked-key")).toBe("stale");
    expect(sessionStorage.getItem("clearable-key")).toBeNull();
  });

  it("starts a new flow only at a start action, not merely after result persistence", () => {
    expect(shouldResetSessionForStart({ startedAt: "100", draft: null, result: "current-result" })).toBe(true);
    expect(
      shouldResetSessionForStart({
        startedAt: "100",
        draft: JSON.stringify({ step: 2, answers: { grade_stage: "primary" } }),
        result: "older-result",
      }),
    ).toBe(false);
    expect(
      shouldResetSessionForStart({
        startedAt: "100",
        draft: JSON.stringify({ step: 0, answers: { grade_stage: "primary" } }),
        result: null,
      }),
    ).toBe(false);
    expect(
      shouldResetSessionForStart({
        startedAt: "100",
        draft: JSON.stringify({ step: 0, answers: {} }),
        result: "current-result",
      }),
    ).toBe(true);
  });
});
