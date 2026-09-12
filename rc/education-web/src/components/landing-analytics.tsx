"use client";

import { useEffect } from "react";

import { deviceCategory, trackCompassEvent } from "@/lib/analytics";

export function LandingAnalytics() {
  useEffect(() => {
    trackCompassEvent(
      "free_compass_viewed",
      {
        device: deviceCategory(),
        referrer: document.referrer ? "referral" : "direct",
      },
      "landing-viewed",
    );
  }, []);

  return null;
}
