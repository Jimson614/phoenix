import { ASSESSMENT_VERSION, RESULT_VERSION } from "@/lib/compass/types";
import { readSessionItem, writeSessionItem } from "@/lib/session-storage";

export type CompassEventName =
  | "free_compass_viewed"
  | "free_compass_started"
  | "free_compass_completed"
  | "free_compass_result_viewed"
  | "result_helpfulness_submitted";

type EventProperties = Readonly<Record<string, string | number | boolean | undefined>>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function deviceCategory(): "mobile" | "desktop" {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 47.99rem)").matches
    ? "mobile"
    : "desktop";
}

export function durationBucket(startedAt: number | null): string {
  if (!startedAt) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (seconds <= 30) return "0-30s";
  if (seconds <= 60) return "31-60s";
  return "61s+";
}

export function trackCompassEvent(
  event: CompassEventName,
  properties: EventProperties = {},
  onceKey?: string,
): void {
  if (typeof window === "undefined") return;
  if (onceKey && readSessionItem(`pn:event:${onceKey}`)) return;

  const payload = {
    ...properties,
    event,
    assessment_version: ASSESSMENT_VERSION,
  };
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(payload);
  window.dispatchEvent(new CustomEvent("phoenix-compass:analytics", { detail: payload }));
  if (onceKey) writeSessionItem(`pn:event:${onceKey}`, "1");
}

export const resultVersion = RESULT_VERSION;
