import { AOYU_MESSAGES, AOYU_STATES, type AoyuPresentationEvent, type AoyuState } from "./contract";

export const ENCOURAGEMENT_COOLDOWN_MS = 90_000;

export interface AoyuStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface DailyLedger {
  dayKey: string;
  welcomeConsumed: boolean;
  lastMessage: AoyuState | null;
  lastPresentedAt: number | null;
  consumedEventIds: string[];
}

interface Ledger {
  version: 1;
  revision: number;
  daily: DailyLedger;
  // Kept across calendar boundaries: 23:59 → 00:00 is still a 90-second cooldown.
  lastEncouragementAt: number | null;
  completionKeys: string[];
}

export type PresentationReason = "SHOW" | "DUPLICATE_EVENT" | "DUPLICATE_COMPLETION" | "WELCOME_LIMIT"
  | "COOLDOWN" | "REPEATED_MESSAGE" | "HIDDEN" | "MISSING_COMPLETION_KEY" | "INVALID_EVENT" | "STORAGE_UNAVAILABLE";

export interface PresentationDecision {
  show: boolean;
  state: AoyuState;
  message: string | null;
  reason: PresentationReason;
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyDaily(dayKey: string): DailyLedger {
  return { dayKey, welcomeConsumed: false, lastMessage: null, lastPresentedAt: null, consumedEventIds: [] };
}

function emptyLedger(dayKey: string): Ledger {
  return { version: 1, revision: 0, daily: emptyDaily(dayKey), lastEncouragementAt: null, completionKeys: [] };
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseLedger(raw: string): Ledger {
  const data = JSON.parse(raw) as Partial<Ledger> | null;
  if (!data || data.version !== 1 || typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) || data.revision < 0
    || !data.daily || typeof data.daily.dayKey !== "string"
    || typeof data.daily.welcomeConsumed !== "boolean" || !stringArray(data.daily.consumedEventIds)
    || !stringArray(data.completionKeys)
    || (data.daily.lastMessage !== null && !AOYU_STATES.includes(data.daily.lastMessage))
    || (data.daily.lastPresentedAt !== null && (typeof data.daily.lastPresentedAt !== "number" || !Number.isFinite(data.daily.lastPresentedAt)))
    || (data.lastEncouragementAt !== null && (typeof data.lastEncouragementAt !== "number" || !Number.isFinite(data.lastEncouragementAt)))) {
    throw new Error("Invalid Aoyu presentation ledger");
  }
  return data as Ledger;
}

function mergeWithMemory(stored: Ledger, memory: Ledger | null): Ledger {
  if (!memory) return stored;
  stored.completionKeys = [...new Set([...stored.completionKeys, ...memory.completionKeys])];
  if (memory.lastEncouragementAt !== null) {
    stored.lastEncouragementAt = stored.lastEncouragementAt === null
      ? memory.lastEncouragementAt : Math.max(stored.lastEncouragementAt, memory.lastEncouragementAt);
  }
  if (stored.daily.dayKey === memory.daily.dayKey) {
    stored.daily.consumedEventIds = [...new Set([...stored.daily.consumedEventIds, ...memory.daily.consumedEventIds])];
    stored.daily.welcomeConsumed ||= memory.daily.welcomeConsumed;
    // Revision disambiguates separate events recorded in the same millisecond.
    if (memory.revision > stored.revision) {
      stored.daily.lastMessage = memory.daily.lastMessage;
      stored.daily.lastPresentedAt = memory.daily.lastPresentedAt;
    }
  }
  stored.revision = Math.max(stored.revision, memory.revision);
  return stored;
}

/**
 * Consume exactly once when a real event arrives, even while hidden. Persist before
 * presenting. The browser must serialize calls across tabs (Web Locks) because
 * getItem/setItem are not an atomic read-modify-write. This is a display ledger,
 * not an academic state machine or event queue.
 */
export function createPresentationPolicy(storage: AoyuStorage | null, scopeKey: string) {
  const key = `aoyu:presentation:v1:${encodeURIComponent(scopeKey)}`;
  let memory: Ledger | null = null;

  return {
    consume(event: AoyuPresentationEvent, context: { nowMs: number; dayKey: string; visible: boolean }): PresentationDecision {
      const decision = (reason: PresentationReason): PresentationDecision => ({
        show: reason === "SHOW",
        state: event.state,
        message: reason === "SHOW" ? AOYU_MESSAGES[event.state] : null,
        reason,
      });
      if (!event.eventId.trim() || !scopeKey.trim() || !context.dayKey || !Number.isFinite(context.nowMs)
        || !AOYU_STATES.includes(event.state)) return decision("INVALID_EVENT");

      let durable = false;
      let ledger = memory ?? emptyLedger(context.dayKey);
      if (storage) {
        try {
          const raw = storage.getItem(key);
          ledger = raw === null ? (memory ?? emptyLedger(context.dayKey)) : mergeWithMemory(parseLedger(raw), memory);
          durable = true;
        } catch {
          // Do not let unavailable/quota/corrupt local storage block the student task.
        }
      }
      if (ledger.daily.dayKey !== context.dayKey) ledger.daily = emptyDaily(context.dayKey);
      memory = ledger;
      if (ledger.daily.consumedEventIds.includes(event.eventId)) {
        // If an earlier write failed, a duplicate after recovery safely flushes
        // its consumed marker; a subsequent refresh must not revive that event.
        try { storage?.setItem(key, JSON.stringify(ledger)); } catch { /* Remain suppressed. */ }
        return decision("DUPLICATE_EVENT");
      }
      ledger.revision += 1;

      let reason: PresentationReason = "SHOW";
      if (event.state === "CELEBRATE") {
        if (!event.completionKey?.trim()) reason = "MISSING_COMPLETION_KEY";
        else if (ledger.completionKeys.includes(event.completionKey)) reason = "DUPLICATE_COMPLETION";
      }
      if (reason === "SHOW" && event.state === "WELCOME" && ledger.daily.welcomeConsumed) reason = "WELCOME_LIMIT";
      if (reason === "SHOW" && event.state === "ENCOURAGE" && ledger.lastEncouragementAt !== null
        && context.nowMs - ledger.lastEncouragementAt < ENCOURAGEMENT_COOLDOWN_MS) reason = "COOLDOWN";
      if (reason === "SHOW" && ledger.daily.lastMessage === event.state) reason = "REPEATED_MESSAGE";
      if (reason === "SHOW" && !context.visible) reason = "HIDDEN";
      if (reason === "SHOW" && !durable && (event.state === "WELCOME" || event.state === "CELEBRATE")) reason = "STORAGE_UNAVAILABLE";

      // Suppressed events are consumed too: returning to a tab never drains a backlog.
      ledger.daily.consumedEventIds.push(event.eventId);
      if (event.state === "WELCOME") ledger.daily.welcomeConsumed = true;
      if (event.state === "CELEBRATE" && event.completionKey?.trim() && !ledger.completionKeys.includes(event.completionKey)) {
        ledger.completionKeys.push(event.completionKey);
      }

      const previousMessage = ledger.daily.lastMessage;
      const previousPresentedAt = ledger.daily.lastPresentedAt;
      const previousEncouragementAt = ledger.lastEncouragementAt;
      if (reason === "SHOW") {
        ledger.daily.lastMessage = event.state;
        ledger.daily.lastPresentedAt = context.nowMs;
        if (event.state === "ENCOURAGE") ledger.lastEncouragementAt = context.nowMs;
      }
      try {
        if (!storage) durable = false;
        else storage.setItem(key, JSON.stringify(ledger));
      } catch {
        durable = false;
      }
      if (!durable && reason === "SHOW" && (event.state === "CELEBRATE" || event.state === "WELCOME")) {
        ledger.daily.lastMessage = previousMessage;
        ledger.daily.lastPresentedAt = previousPresentedAt;
        ledger.lastEncouragementAt = previousEncouragementAt;
        reason = "STORAGE_UNAVAILABLE";
      }
      return decision(reason);
    },
  };
}
