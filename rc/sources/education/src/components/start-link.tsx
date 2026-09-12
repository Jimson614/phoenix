"use client";

import Link from "next/link";

import { deviceCategory, trackCompassEvent } from "@/lib/analytics";
import {
  readSessionItem,
  removeSessionItems,
  shouldResetSessionForStart,
  writeSessionItem,
} from "@/lib/session-storage";

const STARTED_AT_KEY = "pn:free-compass:started-at";
const DRAFT_KEY = "pn:free-compass:draft";
const RESULT_KEY = "pn:free-compass:result";
const NEW_FLOW_RESET_KEYS = [
  RESULT_KEY,
  "pn:free-compass:feedback-submitted",
  "pn:event:assessment-started",
  "pn:event:assessment-completed",
  "pn:event:result-viewed",
  "pn:event:feedback-submitted",
] as const;

export function StartLink({ placement }: { placement: "hero" | "final" }) {
  function handleStart() {
    const storedStartValue = readSessionItem(STARTED_AT_KEY);
    const storedStart = Number(storedStartValue);
    const hasValidStart = Number.isFinite(storedStart) && storedStart > 0;
    const shouldReset = shouldResetSessionForStart({
      startedAt: storedStartValue,
      draft: readSessionItem(DRAFT_KEY),
      result: readSessionItem(RESULT_KEY),
    });
    if (shouldReset) {
      removeSessionItems(NEW_FLOW_RESET_KEYS);
    }
    if (shouldReset || !hasValidStart) {
      writeSessionItem(STARTED_AT_KEY, String(Date.now()));
    }
    trackCompassEvent(
      "free_compass_started",
      { device: deviceCategory(), placement },
      "assessment-started",
    );
  }

  return (
    <Link className="primary-cta" href="/assessment" onClick={handleStart}>
      开始30秒成长探索
      <span aria-hidden="true">→</span>
    </Link>
  );
}
