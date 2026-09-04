// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AoYuCompanion, { type AoYuCompanionProps, type ApprovedAoyuAsset } from "./aoyu-companion";
import { AOYU_MESSAGES } from "../../lib/aoyu/contract";

type ObserverRecord = { callback: IntersectionObserverCallback; element?: Element; disconnected: boolean };
const approvedArtwork: ApprovedAoyuAsset = {
  version: "1.1", approvalRef: "TEST-ONLY-NO-ARTWORK-ACCEPTANCE",
  src: "/assets/aoyu/chenglin-v1.1/test-master.png", alt: "测试专用鳌鱼",
  closedEyesSrc: "/assets/aoyu/chenglin-v1.1/test-closed-eyes.png",
};
let roots: Root[];
let container: HTMLDivElement;
let root: Root;
let observers: ObserverRecord[];
let mediaListeners: Set<(event: MediaQueryListEvent) => void>;
let reduced: boolean;
let pageVisibility: DocumentVisibilityState;
let lockRequest: ReturnType<typeof vi.fn>;

async function render(props: Partial<AoYuCompanionProps> = {}, target = root) {
  await act(async () => {
    target.render(<AoYuCompanion scopeKey="student-test" aoyuState="FOCUS" eventKey="focus-1" {...props} />);
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
async function advance(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
async function visibility(value: DocumentVisibilityState) {
  await act(async () => {
    pageVisibility = value;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
async function intersection(value: boolean) {
  await act(async () => {
    observers.filter((item) => !item.disconnected).forEach((item) =>
      item.callback([{ isIntersecting: value, target: item.element } as IntersectionObserverEntry], {} as IntersectionObserver));
  });
}
function section() { return container.querySelector("section")!; }
function speech() { return container.querySelector('[role="status"]')!.textContent; }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T10:00:00Z"));
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  localStorage.clear();
  roots = [];
  observers = [];
  reduced = false;
  pageVisibility = "visible";
  mediaListeners = new Set();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => pageVisibility });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return reduced; }, media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
  })));
  vi.stubGlobal("IntersectionObserver", class {
    record: ObserverRecord;
    constructor(callback: IntersectionObserverCallback) {
      this.record = { callback, disconnected: false };
      observers.push(this.record);
    }
    observe(element: Element) {
      this.record.element = element;
      this.record.callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect() { this.record.disconnected = true; }
  });
  const queues = new Map<string, Promise<unknown>>();
  lockRequest = vi.fn((name: string, _options: unknown, callback: () => unknown) => {
    const result = (queues.get(name) ?? Promise.resolve()).then(callback);
    queues.set(name, result.catch(() => undefined));
    return result;
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: lockRequest } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  roots.push(root);
});

afterEach(async () => {
  await act(async () => { roots.forEach((item) => item.unmount()); });
  // jsdom queues zero-delay StorageEvent delivery separately from component timers.
  await act(async () => { vi.advanceTimersByTime(0); });
  const remainingTimers = vi.getTimerCount();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(remainingTimers).toBe(0);
});

describe("AoYuCompanion client lifecycle", () => {
  it("uses fixed phrases and consumes initial feedback only after the component is observed", async () => {
    await render();
    expect(section().dataset.visible).toBe("true");
    expect(speech()).toBe(AOYU_MESSAGES.FOCUS);
    expect(lockRequest).toHaveBeenCalledWith("aoyu:presentation:student-test", { mode: "exclusive" }, expect.any(Function));
    await render();
    expect(lockRequest).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(speech()).toBe("");
    await render();
    expect(speech()).toBe("");
  });

  it("consumes hidden completion without replaying when the tab becomes visible", async () => {
    await render({ approvedAsset: approvedArtwork });
    await visibility("hidden");
    await render({ approvedAsset: approvedArtwork, aoyuState: "CELEBRATE", eventKey: "complete-1", completionKey: "evidence-1" });
    expect(speech()).toBe("");
    expect(section().dataset.eventResult).toBe("HIDDEN");
    expect(section().dataset.motion).toBe("paused");
    await visibility("visible");
    expect(speech()).toBe("");
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
    expect(lockRequest).toHaveBeenCalledTimes(2);
  });

  it("offscreen pauses timers and discards the old blink instead of catching up", async () => {
    await render({ approvedAsset: approvedArtwork });
    await advance(8400);
    expect(container.querySelector('[data-blinking="true"]')).not.toBeNull();
    await intersection(false);
    expect(section().dataset.motion).toBe("paused");
    expect(container.querySelector('[data-blinking="true"]')).toBeNull();
    await advance(60000);
    await intersection(true);
    expect(container.querySelector('[data-blinking="true"]')).toBeNull();
    await advance(8399);
    expect(container.querySelector('[data-blinking="true"]')).toBeNull();
    await advance(1);
    expect(container.querySelector('[data-blinking="true"]')).not.toBeNull();
    await advance(360);
    expect(container.querySelector('[data-blinking="true"]')).toBeNull();
  });

  it("reduced motion stops ambient/celebration animation and uses only low-frequency approved blinking", async () => {
    await render({ approvedAsset: approvedArtwork });
    await act(async () => {
      reduced = true;
      mediaListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });
    await render({ approvedAsset: approvedArtwork, aoyuState: "CELEBRATE", eventKey: "reduced-complete", completionKey: "reduced-evidence" });
    expect(section().dataset.motion).toBe("reduced");
    expect(speech()).toBe(AOYU_MESSAGES.CELEBRATE);
    expect(container.querySelector('[data-ambient="true"]')).toBeNull();
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
    await advance(24999);
    expect(container.querySelector('[data-blinking="true"]')).toBeNull();
    await advance(1);
    expect(container.querySelector('[data-blinking="true"]')).not.toBeNull();
  });

  it("pause and text controls do not replay a prior celebration or hidden bubble", async () => {
    await render({ approvedAsset: approvedArtwork, aoyuState: "CELEBRATE", eventKey: "complete", completionKey: "evidence" });
    expect(container.querySelector('[data-celebrating="true"]')).not.toBeNull();
    await click("暂停动画");
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
    await click("继续动画");
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
    await click("关闭鼓励文字");
    expect(speech()).toBe("");
    await render({ approvedAsset: approvedArtwork, aoyuState: "HINT", eventKey: "hint-1" });
    await click("显示鼓励文字");
    expect(speech()).toBe("");
  });

  it("serializes two independent mounted clients using the same scope before reading the shared ledger", async () => {
    const otherContainer = document.createElement("div");
    document.body.appendChild(otherContainer);
    const other = createRoot(otherContainer);
    roots.push(other);
    await act(async () => {
      root.render(<AoYuCompanion scopeKey="shared-student" aoyuState="CELEBRATE" eventKey="tab-a-complete" completionKey="same-evidence" />);
      other.render(<AoYuCompanion scopeKey="shared-student" aoyuState="CELEBRATE" eventKey="tab-b-complete" completionKey="same-evidence" />);
    });
    const outputs = [...document.querySelectorAll('[role="status"]')].map((item) => item.textContent);
    expect(outputs.filter((text) => text === AOYU_MESSAGES.CELEBRATE)).toHaveLength(1);
    expect(lockRequest.mock.calls.map((call) => call[0])).toEqual(["aoyu:presentation:shared-student", "aoyu:presentation:shared-student"]);
    const results = [...document.querySelectorAll("section")].map((item) => item.dataset.eventResult);
    expect(results).toContain("DUPLICATE_COMPLETION");
  });

  it("queued old completions cannot overwrite a newer error after acquiring the lock", async () => {
    const release: Array<() => void> = [];
    lockRequest.mockImplementation((_name: string, _options: unknown, callback: () => unknown) =>
      new Promise((resolve) => release.push(() => resolve(callback()))));
    await render({ approvedAsset: approvedArtwork, aoyuState: "CELEBRATE", eventKey: "queued-complete", completionKey: "queued-evidence" });
    await render({ approvedAsset: approvedArtwork, aoyuState: "SAFE_ERROR", eventKey: "save-error" });
    await act(async () => { release.splice(0).forEach((run) => run()); });
    expect(speech()).toBe(AOYU_MESSAGES.SAFE_ERROR);
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
    await render({ approvedAsset: approvedArtwork, aoyuState: "CELEBRATE", eventKey: "same-evidence-new-read", completionKey: "queued-evidence" });
    await act(async () => { release.splice(0).forEach((run) => run()); });
    expect(speech()).toBe("");
    expect(section().dataset.eventResult).toBe("DUPLICATE_COMPLETION");
  });

  it("a new error immediately clears an active celebration while its own lock request waits", async () => {
    await render({ approvedAsset: approvedArtwork, aoyuState: "CELEBRATE", eventKey: "active-complete", completionKey: "active-evidence" });
    expect(container.querySelector('[data-celebrating="true"]')).not.toBeNull();
    const release: Array<() => void> = [];
    lockRequest.mockImplementation((_name: string, _options: unknown, callback: () => unknown) =>
      new Promise((resolve) => release.push(() => resolve(callback()))));
    await render({ approvedAsset: approvedArtwork, aoyuState: "SAFE_ERROR", eventKey: "active-error" });
    expect(speech()).toBe("");
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
    await act(async () => { release.splice(0).forEach((run) => run()); });
    expect(speech()).toBe(AOYU_MESSAGES.SAFE_ERROR);
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
  });

  it("a queued click cannot replace a newer real task state", async () => {
    await render();
    const release: Array<() => void> = [];
    lockRequest.mockImplementation((_name: string, _options: unknown, callback: () => unknown) =>
      new Promise((resolve) => release.push(() => resolve(callback()))));
    await click("给我一句鼓励");
    await render({ aoyuState: "SAFE_ERROR", eventKey: "error-after-click" });
    await act(async () => { release.splice(0).forEach((run) => run()); });
    expect(speech()).toBe(AOYU_MESSAGES.SAFE_ERROR);
    expect(section().dataset.aoyuState).toBe("SAFE_ERROR");
  });

  it("a hide/show cycle while waiting for a lock consumes the old event without displaying it", async () => {
    const release: Array<() => void> = [];
    lockRequest.mockImplementation((_name: string, _options: unknown, callback: () => unknown) =>
      new Promise((resolve) => release.push(() => resolve(callback()))));
    await render({ aoyuState: "WELCOME", eventKey: "queued-welcome" });
    await act(async () => {
      pageVisibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      pageVisibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => { release.splice(0).forEach((run) => run()); });
    expect(speech()).toBe("");
    expect(lockRequest).toHaveBeenCalledTimes(1);
    await render({ aoyuState: "WELCOME", eventKey: "welcome-again" });
    await act(async () => { release.splice(0).forEach((run) => run()); });
    expect(speech()).toBe("");
    expect(section().dataset.eventResult).toBe("WELCOME_LIMIT");
  });

  it("fails closed for one-shot feedback without Web Locks and preserves ordinary fixed text", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await render({ aoyuState: "WELCOME", eventKey: "no-lock-welcome" });
    expect(speech()).toBe("");
    expect(section().dataset.eventResult).toBe("LOCK_UNAVAILABLE");
    await render({ aoyuState: "CELEBRATE", eventKey: "no-lock-complete", completionKey: "no-lock-evidence" });
    expect(speech()).toBe("");
    await render({ aoyuState: "FOCUS", eventKey: "no-lock-focus" });
    expect(speech()).toBe(AOYU_MESSAGES.FOCUS);
    expect(section().dataset.lockStatus).toBe("UNAVAILABLE");
  });

  it("a rejected lock request cannot display a one-shot celebration or break the component", async () => {
    lockRequest.mockRejectedValue(new DOMException("Web Locks unavailable", "SecurityError"));
    await render({ approvedAsset: approvedArtwork, aoyuState: "CELEBRATE", eventKey: "lock-rejected", completionKey: "lock-rejected-evidence" });
    expect(speech()).toBe("");
    expect(section().dataset.eventResult).toBe("LOCK_UNAVAILABLE");
    expect(container.querySelector('[data-celebrating="true"]')).toBeNull();
  });

  it("puts clicks through the same mutex and enforces the 90-second encouragement cooldown", async () => {
    await render();
    await click("给我一句鼓励");
    expect(speech()).toBe(AOYU_MESSAGES.ENCOURAGE);
    await advance(1);
    await click("给我一句鼓励");
    expect(section().dataset.eventResult).toBe("COOLDOWN");
    expect(lockRequest).toHaveBeenCalledTimes(3);
    await advance(89999);
    await render({ aoyuState: "WAITING", eventKey: "wait-after-cooldown" });
    await click("给我一句鼓励");
    expect(section().dataset.eventResult).toBe("SHOW");
    expect(speech()).toBe(AOYU_MESSAGES.ENCOURAGE);
  });

  it("switching student scope prevents a pending result from leaking into the next student", async () => {
    const release: Array<() => void> = [];
    lockRequest.mockImplementation((_name: string, _options: unknown, callback: () => unknown) =>
      new Promise((resolve) => release.push(() => resolve(callback()))));
    await render({ scopeKey: "student-a", aoyuState: "CELEBRATE", eventKey: "a-complete", completionKey: "a-evidence" });
    await render({ scopeKey: "student-b", aoyuState: "FOCUS", eventKey: "b-focus" });
    await act(async () => { release.splice(0).forEach((run) => run()); });
    expect(speech()).toBe(AOYU_MESSAGES.FOCUS);
    expect(lockRequest.mock.calls.map((call) => call[0])).toEqual(["aoyu:presentation:student-a", "aoyu:presentation:student-b"]);
  });
});
