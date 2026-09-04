import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AoYuCompanion, { type ApprovedAoyuAsset } from "./aoyu-companion";
import { AOYU_STATES } from "../../lib/aoyu/contract";

describe("AoYuCompanion safe rendering", () => {
  it("does not invent progress or substitute legacy artwork when approved assets are absent", () => {
    const html = renderToStaticMarkup(<AoYuCompanion aoyuState="WELCOME" />);
    expect(html).toContain('data-progress-status="UNKNOWN"');
    expect(html).toContain('data-asset-status="BLOCKED_ASSET"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("42%");
    expect(html).not.toContain("0%");
    expect(html).toContain("鳌鱼伴学");
    expect(html).toContain('type="button"');
  });

  it("maps 42 to the approved 成鳞 interval without changing the provided learning progress", () => {
    const html = renderToStaticMarkup(<AoYuCompanion aoyuState="FOCUS" progress={42} />);
    expect(html).toContain('data-stage="CHENGLIN"');
    expect(html).toContain('data-stage-progress="0.041666666666666664"');
    expect(html).toContain("成鳞 · 42%");
  });

  it.each(AOYU_STATES)("renders %s accessibly without playing feedback before its visibility and event audit", (state) => {
    const html = renderToStaticMarkup(<AoYuCompanion aoyuState={state} soundEnabled />);
    expect(html).toContain(`data-aoyu-state="${state}"`);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-sound-enabled="false"');
    expect(html).toContain('data-event-result="PENDING"');
    expect(html).not.toMatch(/<audio|autoplay|<video/i);
    expect(html).not.toContain('data-celebrating="true"');
  });

  const artwork: ApprovedAoyuAsset = {
    version: "1.1", approvalRef: "test-approved-ref", src: "/assets/aoyu/chenglin-v1.1/master.png", alt: "成鳞鳌鱼",
  };

  it("will not relabel an old asset directory as the V1.1 master", () => {
    const html = renderToStaticMarkup(<AoYuCompanion aoyuState="FOCUS" approvedAsset={{ ...artwork, src: "/assets/aoyu/hero/default.png" }} />);
    expect(html).toContain('data-asset-status="BLOCKED_ASSET"');
    expect(html).not.toContain("<img");
  });

  it("requires the approval reference and does not invent a closed-eye overlay", () => {
    const unapproved = renderToStaticMarkup(<AoYuCompanion aoyuState="FOCUS" approvedAsset={{ ...artwork, approvalRef: "" }} />);
    expect(unapproved).not.toContain("<img");
    const approved = renderToStaticMarkup(<AoYuCompanion aoyuState="FOCUS" approvedAsset={artwork} />);
    expect(approved).toContain('data-asset-status="APPROVED_V1_1"');
    expect(approved).toContain('data-blink-status="UNAVAILABLE"');
    expect(approved.match(/<img/g)).toHaveLength(1);
  });

  it("keeps an explicitly approved aligned eye layer decorative and paused until observed", () => {
    const html = renderToStaticMarkup(<AoYuCompanion aoyuState="FOCUS" approvedAsset={{ ...artwork, closedEyesSrc: "/assets/aoyu/chenglin-v1.1/closed-eyes.png" }} />);
    expect(html).toContain('data-blink-status="APPROVED_LAYER"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-blinking="false"');
    expect(html).toContain('data-motion="paused"');
  });
});
