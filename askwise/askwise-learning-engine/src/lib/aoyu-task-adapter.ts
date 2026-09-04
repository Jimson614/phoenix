import { mapSystemEventToAoyu, stableCompletionKey, type AoyuPresentationEvent } from "./aoyu/contract";

export type TaskCompanionSnapshot = {
  taskId: number;
  sessionId: number;
  solved: boolean;
  evidenceConfirmed: boolean;
  hintLevel: number;
  attemptCount: number;
};

/** Read-only translation of persisted ASKWISE data, with no fabricated progress/pause. */
export function taskCompanionEvent(snapshot: TaskCompanionSnapshot): AoyuPresentationEvent {
  const prefix = `task:${snapshot.taskId}:session:${snapshot.sessionId}`;
  if (snapshot.solved && snapshot.evidenceConfirmed) {
    return mapSystemEventToAoyu({ type: "COMPLETED", evidenceConfirmed: true,
      completionKey: stableCompletionKey(snapshot), eventId: `${prefix}:completed` })!;
  }
  if (!snapshot.solved && [1, 2, 3].includes(snapshot.hintLevel)) {
    return mapSystemEventToAoyu({ type: "HINT", hintLevel: snapshot.hintLevel,
      eventId: `${prefix}:hint:${snapshot.hintLevel}:attempt:${snapshot.attemptCount}` })!;
  }
  return mapSystemEventToAoyu({ type: "WAITING_FOR_INPUT",
    eventId: `${prefix}:waiting:${snapshot.attemptCount}:${snapshot.hintLevel}:${snapshot.solved}` })!;
}
