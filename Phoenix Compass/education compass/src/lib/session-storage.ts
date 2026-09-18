function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSessionItem(key: string): string | null {
  try {
    return getSessionStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeSessionItem(key: string, value: string): boolean {
  try {
    const storage = getSessionStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeSessionItems(keys: readonly string[]): void {
  const storage = getSessionStorage();
  if (!storage) return;

  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // A storage implementation can fail per key. Continue so one stale value
      // does not prevent the rest of the flow state from being cleared.
    }
  }
}

export function shouldResetSessionForStart(values: {
  startedAt: string | null;
  draft: string | null;
  result: string | null;
}): boolean {
  const startedAt = Number(values.startedAt);
  const hasValidStart = Number.isFinite(startedAt) && startedAt > 0;
  let hasDraftAnswers = false;

  if (values.draft) {
    try {
      const parsed = JSON.parse(values.draft) as { answers?: unknown };
      hasDraftAnswers =
        parsed !== null &&
        typeof parsed === "object" &&
        parsed.answers !== null &&
        typeof parsed.answers === "object" &&
        Object.keys(parsed.answers).length > 0;
    } catch {
      hasDraftAnswers = false;
    }
  }

  return !hasDraftAnswers && (!hasValidStart || Boolean(values.result));
}
