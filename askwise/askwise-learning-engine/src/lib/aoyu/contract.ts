export const AOYU_STATES = ["WELCOME", "FOCUS", "WAITING", "HINT", "ENCOURAGE", "CELEBRATE", "SAFE_ERROR"] as const;
export type AoyuState = (typeof AOYU_STATES)[number];

export const AOYU_MESSAGES: Record<AoyuState, string> = {
  WELCOME: "今天也从一小步开始。",
  FOCUS: "先看清楚题目，我陪你慢慢来。",
  WAITING: "想好再回答，不着急。",
  HINT: "先找出真正卡住的那一步。",
  ENCOURAGE: "再试一次，把刚才的发现用上。",
  CELEBRATE: "这一片新鳞，是你自己长出来的。",
  SAFE_ERROR: "刚才没有保存成功，我们稍后再试。",
};

/** Presentation metadata only. It never modifies a learning/session/evidence record. */
export interface AoyuPresentationEvent {
  state: AoyuState;
  eventId: string;
  completionKey?: string;
}

type EventIdentity = { eventId: string };
export type AoyuSystemEvent = EventIdentity & (
  | { type: "READY" | "STARTED" | "WAITING_FOR_INPUT" | "RETRY" | "FAILED" }
  | { type: "HINT"; hintLevel: number }
  | { type: "COMPLETED"; evidenceConfirmed: boolean; completionKey: string }
);

/** Translate an existing system event; unsupported/missing evidence stays unconnected. */
export function mapSystemEventToAoyu(event: AoyuSystemEvent): AoyuPresentationEvent | null {
  if (!event.eventId.trim()) return null;
  let state: AoyuState;
  switch (event.type) {
    case "READY": state = "WELCOME"; break;
    case "STARTED": state = "FOCUS"; break;
    case "WAITING_FOR_INPUT": state = "WAITING"; break;
    case "HINT":
      if (![1, 2, 3].includes(event.hintLevel)) return null;
      state = "HINT";
      break;
    case "RETRY": state = "ENCOURAGE"; break;
    case "FAILED": state = "SAFE_ERROR"; break;
    case "COMPLETED":
      if (!event.evidenceConfirmed || !event.completionKey.trim()) return null;
      return { state: "CELEBRATE", eventId: event.eventId, completionKey: event.completionKey };
    default: return null;
  }
  return { state, eventId: event.eventId };
}

/** The learning snapshot supplies priority; technical failure never leaves celebration running. */
export function selectAoyuEvent(events: readonly AoyuSystemEvent[]): AoyuPresentationEvent | null {
  const failure = events.find((event) => event.type === "FAILED");
  if (failure) return mapSystemEventToAoyu(failure);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const result = mapSystemEventToAoyu(events[index]);
    if (result) return result;
  }
  return null;
}

/** Avoid an INSERT OR REPLACE evidence row id: task/session identify the completion. */
export function stableCompletionKey(input: { taskId: string | number; sessionId: string | number }): string {
  return `task:${encodeURIComponent(String(input.taskId))}:session:${encodeURIComponent(String(input.sessionId))}:completed`;
}
