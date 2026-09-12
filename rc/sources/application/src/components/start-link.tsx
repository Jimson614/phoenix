"use client";

import Link from "next/link";

import { deviceCategory, trackCompassEvent } from "@/lib/analytics";

const STARTED_AT_KEY = "pn:free-compass:started-at";

export function StartLink({ placement }: { placement: "hero" | "final" }) {
  function handleStart() {
    if (!sessionStorage.getItem(STARTED_AT_KEY)) {
      sessionStorage.setItem(STARTED_AT_KEY, String(Date.now()));
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
