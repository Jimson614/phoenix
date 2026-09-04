import { describe, expect, it } from "vitest";
import { AOYU_MESSAGES, AOYU_STATES, mapSystemEventToAoyu, selectAoyuEvent, stableCompletionKey, type AoyuPresentationEvent, type AoyuState } from "./contract";
import { calculateAoyuStage } from "./stage";
import { BLINK_PARAMETERS, getMotionPolicy, nextBlinkDelay, shouldDoubleBlink } from "./motion";
import { createPresentationPolicy, localDayKey, type AoyuStorage } from "./presentation-policy";

function makeStorage(): AoyuStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
function event(state: AoyuState, eventId: string, completionKey?: string): AoyuPresentationEvent {
  return { state, eventId, completionKey };
}
const context = (nowMs = 0, visible = true, dayKey = "2026-09-04") => ({ nowMs, visible, dayKey });

describe("approved growth bands", () => {
  it.each([
    [20, "YOULIN", 1], [21, "ZHULIU", 0],
    [40, "ZHULIU", 1], [41, "CHENGLIN", 0],
    [65, "CHENGLIN", 1], [66, "LINGBO", 0],
    [85, "LINGBO", 1], [86, "FEITIAN", 0],
    [0, "YOULIN", 0], [100, "FEITIAN", 1],
  ])("%s maps to %s with internal progress %s", (progress, stage, internal) => {
    expect(calculateAoyuStage(progress as number)).toMatchObject({ stage, stageProgress: internal });
  });
  it("42 is just inside 成鳞, not 42% inside the stage", () => {
    const result = calculateAoyuStage(42);
    expect(result).toMatchObject({ stage: "CHENGLIN", label: "成鳞", progress: 42, min: 41, max: 65 });
    expect(result?.stageProgress).toBeCloseTo(1 / 24, 10);
  });
  it.each([undefined, NaN, Infinity, -1, 101, 20.5])("does not invent progress for invalid integer-contract input %s", (input) => {
    expect(calculateAoyuStage(input)).toBeNull();
  });
});

describe("system events only translate academic facts", () => {
  it.each([
    ["READY", "WELCOME"], ["STARTED", "FOCUS"], ["WAITING_FOR_INPUT", "WAITING"],
    ["PAUSED", "ENCOURAGE"], ["RETRY", "ENCOURAGE"], ["FAILED", "SAFE_ERROR"],
  ] as const)("maps %s to %s", (type, state) => {
    expect(mapSystemEventToAoyu({ type, eventId: `real:${type}` })).toEqual({ state, eventId: `real:${type}` });
  });
  it.each([1, 2, 3])("maps actual hint level %s", (hintLevel) => {
    expect(mapSystemEventToAoyu({ type: "HINT", eventId: `hint:${hintLevel}`, hintLevel })?.state).toBe("HINT");
  });
  it.each([0, 4, 5, -1, 1.5, NaN])("leaves unapproved hint level %s unconnected", (hintLevel) => {
    expect(mapSystemEventToAoyu({ type: "HINT", eventId: "hint", hintLevel })).toBeNull();
  });
  it("requires confirmed evidence and stable completion metadata", () => {
    expect(mapSystemEventToAoyu({ type: "COMPLETED", eventId: "complete", evidenceConfirmed: false, completionKey: "key" })).toBeNull();
    expect(mapSystemEventToAoyu({ type: "COMPLETED", eventId: "complete", evidenceConfirmed: true, completionKey: "" })).toBeNull();
    expect(mapSystemEventToAoyu({ type: "COMPLETED", eventId: "complete", evidenceConfirmed: true, completionKey: "key" }))
      .toEqual({ state: "CELEBRATE", eventId: "complete", completionKey: "key" });
  });
  it("technical failure takes precedence over completion", () => {
    expect(selectAoyuEvent([
      { type: "FAILED", eventId: "save-failed" },
      { type: "COMPLETED", eventId: "complete", evidenceConfirmed: true, completionKey: "key" },
    ])?.state).toBe("SAFE_ERROR");
  });
  it("has exactly seven fixed messages, with no academic claim added by the renderer", () => {
    expect(Object.keys(AOYU_MESSAGES)).toEqual([...AOYU_STATES]);
    expect(AOYU_MESSAGES.HINT).toBe("先找出真正卡住的那一步。");
    expect(AOYU_MESSAGES.SAFE_ERROR).toBe("刚才没有保存成功，我们稍后再试。");
  });
  it("completion identity does not depend on the replaceable evidence row id", () => {
    expect(stableCompletionKey({ taskId: 7, sessionId: 11 })).toBe("task:7:session:11:completed");
    expect(stableCompletionKey({ taskId: "a:session:b", sessionId: "c" }))
      .not.toBe(stableCompletionKey({ taskId: "a", sessionId: "b:session:c" }));
  });
});

describe("display ledger and anti-interruption rules", () => {
  it("welcomes each scope once per local day, including after refresh", () => {
    const storage = makeStorage();
    const first = createPresentationPolicy(storage, "P1");
    expect(first.consume(event("WELCOME", "enter:1"), context()).show).toBe(true);
    const refreshed = createPresentationPolicy(storage, "P1");
    expect(refreshed.consume(event("WELCOME", "enter:2"), context(1)).reason).toBe("WELCOME_LIMIT");
    expect(refreshed.consume(event("WELCOME", "enter:3"), context(2, true, "2026-09-05")).show).toBe(true);
    expect(createPresentationPolicy(storage, "P2").consume(event("WELCOME", "enter:1"), context()).show).toBe(true);
  });
  it("requires at least 90 seconds between encouragements and consumes suppressed events", () => {
    const policy = createPresentationPolicy(makeStorage(), "P1");
    expect(policy.consume(event("ENCOURAGE", "retry:1"), context()).show).toBe(true);
    policy.consume(event("WAITING", "input:1"), context(1));
    expect(policy.consume(event("ENCOURAGE", "retry:2"), context(89_999)).reason).toBe("COOLDOWN");
    expect(policy.consume(event("ENCOURAGE", "retry:2"), context(90_000)).reason).toBe("DUPLICATE_EVENT");
    expect(policy.consume(event("ENCOURAGE", "retry:3"), context(90_000)).show).toBe(true);
  });
  it("preserves the encouragement cooldown across midnight and refresh", () => {
    const storage = makeStorage();
    const policy = createPresentationPolicy(storage, "P1");
    policy.consume(event("ENCOURAGE", "retry:1"), context(100_000));
    const nextDay = createPresentationPolicy(storage, "P1");
    expect(nextDay.consume(event("ENCOURAGE", "retry:2"), context(101_000, true, "2026-09-05")).reason).toBe("COOLDOWN");
    expect(nextDay.consume(event("ENCOURAGE", "retry:3"), context(190_000, true, "2026-09-05")).show).toBe(true);
  });
  it("does not repeat the same sentence consecutively that day", () => {
    const policy = createPresentationPolicy(makeStorage(), "P1");
    expect(policy.consume(event("HINT", "hint:1"), context()).show).toBe(true);
    expect(policy.consume(event("HINT", "hint:2"), context(1)).reason).toBe("REPEATED_MESSAGE");
    policy.consume(event("WAITING", "wait:1"), context(2));
    expect(policy.consume(event("HINT", "hint:3"), context(3)).show).toBe(true);
  });
  it("celebrates a stable completion once across refresh, new event ids, and calendar days", () => {
    const storage = makeStorage();
    const completionKey = stableCompletionKey({ taskId: 7, sessionId: 11 });
    expect(createPresentationPolicy(storage, "P1").consume(event("CELEBRATE", "row:1", completionKey), context()).show).toBe(true);
    const refreshed = createPresentationPolicy(storage, "P1");
    expect(refreshed.consume(event("CELEBRATE", "row:1", completionKey), context(1)).reason).toBe("DUPLICATE_EVENT");
    expect(refreshed.consume(event("CELEBRATE", "row:2", completionKey), context(2)).reason).toBe("DUPLICATE_COMPLETION");
    expect(refreshed.consume(event("CELEBRATE", "row:3", completionKey), context(3, true, "2026-09-05")).reason).toBe("DUPLICATE_COMPLETION");
  });
  it("consumes hidden completion without replaying on restoration or refresh", () => {
    const storage = makeStorage();
    const policy = createPresentationPolicy(storage, "P1");
    expect(policy.consume(event("CELEBRATE", "done", "session:done"), context(0, false)).reason).toBe("HIDDEN");
    expect(policy.consume(event("CELEBRATE", "done", "session:done"), context(1, true)).reason).toBe("DUPLICATE_EVENT");
    expect(createPresentationPolicy(storage, "P1").consume(event("CELEBRATE", "restore", "session:done"), context(2)).reason).toBe("DUPLICATE_COMPLETION");
    expect(policy.consume(event("FOCUS", "start:hidden"), context(3, false)).reason).toBe("HIDDEN");
    expect(policy.consume(event("FOCUS", "start:hidden"), context(4)).reason).toBe("DUPLICATE_EVENT");
  });
  it("does not celebrate when stable completion metadata is absent", () => {
    expect(createPresentationPolicy(makeStorage(), "P1").consume(event("CELEBRATE", "done"), context()).reason).toBe("MISSING_COMPLETION_KEY");
  });
  it.each(["missing", "read", "write", "corrupt"] as const)("suppresses celebration if storage is %s while ordinary text can continue", (failure) => {
    const storage: AoyuStorage | null = failure === "missing" ? null : {
      getItem: () => {
        if (failure === "read") throw new Error("blocked");
        return failure === "corrupt" ? "{invalid" : null;
      },
      setItem: () => { if (failure === "write") throw new Error("quota"); },
    };
    const policy = createPresentationPolicy(storage, "P1");
    expect(policy.consume(event("CELEBRATE", "done", "completion"), context()).reason).toBe("STORAGE_UNAVAILABLE");
    expect(policy.consume(event("FOCUS", "start"), context(1)).show).toBe(true);
  });
  it("uses a local calendar day, not UTC midnight", () => {
    expect(localDayKey(new Date(2026, 8, 4, 0, 1))).toBe("2026-09-04");
  });
  it("does not replay an event when a temporary storage write failure clears", () => {
    const backing = makeStorage();
    let failWrites = false;
    const storage: AoyuStorage = {
      getItem: backing.getItem,
      setItem: (key, value) => {
        if (failWrites) throw new Error("temporarily unavailable");
        backing.setItem(key, value);
      },
    };
    const policy = createPresentationPolicy(storage, "P1");
    policy.consume(event("FOCUS", "start"), context());
    failWrites = true;
    expect(policy.consume(event("CELEBRATE", "done", "completion"), context(1)).reason).toBe("STORAGE_UNAVAILABLE");
    failWrites = false;
    expect(policy.consume(event("CELEBRATE", "done", "completion"), context(2)).reason).toBe("DUPLICATE_EVENT");
    expect(createPresentationPolicy(storage, "P1").consume(event("CELEBRATE", "refresh", "completion"), context(3)).reason).toBe("DUPLICATE_COMPLETION");
    expect(policy.consume(event("CELEBRATE", "re-render", "completion"), context(3)).reason).toBe("DUPLICATE_COMPLETION");
  });
  it("reads the latest other-tab display even when both events share a millisecond", () => {
    const storage = makeStorage();
    const tabA = createPresentationPolicy(storage, "P1");
    const tabB = createPresentationPolicy(storage, "P1");
    expect(tabA.consume(event("FOCUS", "a:start"), context()).show).toBe(true);
    expect(tabB.consume(event("WAITING", "b:wait"), context()).show).toBe(true);
    expect(tabA.consume(event("WAITING", "a:wait"), context(1)).reason).toBe("REPEATED_MESSAGE");
  });
  it("retains separate completion keys across serialized tabs", () => {
    const storage = makeStorage();
    const tabA = createPresentationPolicy(storage, "P1");
    const tabB = createPresentationPolicy(storage, "P1");
    tabA.consume(event("CELEBRATE", "a:done", "completion:a"), context());
    tabB.consume(event("WAITING", "b:wait"), context(1));
    expect(tabB.consume(event("CELEBRATE", "b:done", "completion:b"), context(2)).show).toBe(true);
    const refreshed = createPresentationPolicy(storage, "P1");
    expect(refreshed.consume(event("CELEBRATE", "refresh:a", "completion:a"), context(3)).reason).toBe("DUPLICATE_COMPLETION");
    expect(refreshed.consume(event("CELEBRATE", "refresh:b", "completion:b"), context(4)).reason).toBe("DUPLICATE_COMPLETION");
  });
});

describe("motion respects visibility and reduced-motion", () => {
  it("retains approved natural blink duration, gap, and six percent double probability", () => {
    expect(BLINK_PARAMETERS.durationMs).toBe(360);
    expect(BLINK_PARAMETERS.doubleGapMs).toBe(540);
    expect(nextBlinkDelay(0)).toBe(5_800);
    expect(nextBlinkDelay(1)).toBe(11_000);
    expect(shouldDoubleBlink(0.059)).toBe(true);
    expect(shouldDoubleBlink(0.06)).toBe(false);
  });
  it("uses low frequency single blinking with no ambient or state animation for reduced-motion", () => {
    expect(nextBlinkDelay(0, true)).toBeGreaterThan(BLINK_PARAMETERS.maxIntervalMs);
    expect(shouldDoubleBlink(0, true)).toBe(false);
    expect(getMotionPolicy({ visible: true, animationEnabled: true, reducedMotion: true }))
      .toEqual({ pauseAll: false, blinkEnabled: true, ambientEnabled: false, stateAnimationEnabled: false });
  });
  it.each([
    { visible: false, animationEnabled: true, reducedMotion: false },
    { visible: true, animationEnabled: false, reducedMotion: false },
    { visible: false, animationEnabled: true, reducedMotion: true },
  ])("pauses every motion source when hidden or disabled: %o", (input) => {
    expect(getMotionPolicy(input)).toEqual({ pauseAll: true, blinkEnabled: false, ambientEnabled: false, stateAnimationEnabled: false });
  });
});
