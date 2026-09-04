"use client";

/* eslint-disable @next/next/no-img-element -- Approved artwork and its aligned eyelid layer must share exact geometry. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { type AoyuState, type AoyuPresentationEvent } from "../../lib/aoyu/contract";
import { calculateAoyuStage } from "../../lib/aoyu/stage";
import { createPresentationPolicy, localDayKey } from "../../lib/aoyu/presentation-policy";
import { BLINK_PARAMETERS, getMotionPolicy, nextBlinkDelay, shouldDoubleBlink } from "../../lib/aoyu/motion";
import styles from "./aoyu-companion.module.css";

/** Only approved V1.1 artwork may replace the text fallback. No asset is bundled yet. */
export type ApprovedAoyuAsset = {
  version: "1.1";
  approvalRef: string;
  src: string;
  alt: string;
  /** Approved transparent closed-eye layer aligned to the same full canvas as src. */
  closedEyesSrc?: string;
};

export type AoYuCompanionProps = {
  progress?: number;
  aoyuState: AoyuState;
  soundEnabled?: boolean;
  scopeKey?: string;
  eventKey?: string;
  completionKey?: string;
  animationEnabled?: boolean;
  approvedAsset?: ApprovedAoyuAsset;
};

function isApprovedPath(path: string): boolean {
  return path.startsWith("/assets/aoyu/chenglin-v1.1/") &&
    !path.includes("..") && !path.includes("?") && !path.includes("#");
}

const STATE_LABELS: Record<AoyuState, string> = {
  WELCOME: "今天一起向前一点",
  FOCUS: "陪你专注",
  WAITING: "慢慢想，不着急",
  HINT: "留一点时间给自己思考",
  ENCOURAGE: "陪你再试一次",
  CELEBRATE: "记录你走过的一小步",
  SAFE_ERROR: "先停一下，稍后再试",
};

export function AoYuCompanion({
  progress, aoyuState, soundEnabled = false, scopeKey = "local-session",
  eventKey, completionKey, animationEnabled = true, approvedAsset,
}: AoYuCompanionProps) {
  const rootRef = useRef<HTMLElement>(null);
  const lastEventRef = useRef<string>();
  const policyRef = useRef<{ scope: string; policy: ReturnType<typeof createPresentationPolicy> }>();
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const liveVisibilityRef = useRef(false);
  const [visibilityReady, setVisibilityReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [paused, setPaused] = useState(false);
  const [textEnabled, setTextEnabled] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [eyesFailed, setEyesFailed] = useState(false);
  const [eventResult, setEventResult] = useState("PENDING");
  const [lockStatus, setLockStatus] = useState("PENDING");
  const stage = calculateAoyuStage(progress);
  const asset = approvedAsset?.version === "1.1" && approvedAsset.approvalRef.trim() &&
    approvedAsset.alt.trim() && isApprovedPath(approvedAsset.src) && !assetFailed
    ? approvedAsset : undefined;
  const eyesSrc = asset?.closedEyesSrc && isApprovedPath(asset.closedEyesSrc) && !eyesFailed
    ? asset.closedEyesSrc : undefined;
  const motion = getMotionPolicy({
    reducedMotion, visible, animationEnabled: animationEnabled && !paused && Boolean(asset),
  });
  const sourceSignature = JSON.stringify([scopeKey, aoyuState, eventKey, completionKey]);
  const contextRef = useRef({ scopeKey, sourceSignature, visible, textEnabled, animationAllowed: motion.stateAnimationEnabled });
  contextRef.current = { scopeKey, sourceSignature, visible, textEnabled, animationAllowed: motion.stateAnimationEnabled };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; generationRef.current += 1; };
  }, []);

  useEffect(() => {
    // A queued lock result may never revive feedback after leaving or changing context.
    generationRef.current += 1;
  }, [sourceSignature, visible, textEnabled, paused, reducedMotion, animationEnabled]);

  const consumeFeedback = useCallback(async (
    event: AoyuPresentationEvent,
    target: { scope: string; policy: ReturnType<typeof createPresentationPolicy> },
  ) => {
    const initial = { ...contextRef.current };
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation &&
      contextRef.current.scopeKey === initial.scopeKey &&
      contextRef.current.sourceSignature === initial.sourceSignature;
    const consume = (allowDisplay = true) => {
      // Time and visibility are read inside the lock, never captured before waiting for it.
      const now = new Date();
      return target.policy.consume(event, {
        nowMs: now.getTime(), dayKey: localDayKey(now),
        visible: allowDisplay && initial.visible && isCurrent() && contextRef.current.visible &&
          liveVisibilityRef.current && document.visibilityState === "visible",
      });
    };
    let result: ReturnType<typeof target.policy.consume>;
    let lockAvailable = false;
    try {
      const locks = navigator.locks;
      if (locks?.request) {
        lockAvailable = true;
        result = await locks.request(`aoyu:presentation:${target.scope}`, { mode: "exclusive" }, () => consume());
      } else {
        // Without a cross-tab mutex, one-shot welcome/celebration feedback fails closed.
        result = consume(event.state !== "WELCOME" && event.state !== "CELEBRATE");
      }
    } catch {
      lockAvailable = false;
      try { result = consume(false); } catch {
        if (isCurrent()) { setEventResult("STORAGE_UNAVAILABLE"); setLockStatus("UNAVAILABLE"); }
        return;
      }
    }
    if (!isCurrent()) return;
    setLockStatus(lockAvailable ? "WEB_LOCKS" : "UNAVAILABLE");
    const oneShotWithoutLock = !lockAvailable && (event.state === "WELCOME" || event.state === "CELEBRATE");
    setEventResult(oneShotWithoutLock ? "LOCK_UNAVAILABLE" : result.reason);
    if (result.show && !oneShotWithoutLock && initial.visible && contextRef.current.visible &&
      liveVisibilityRef.current && document.visibilityState === "visible") {
      if (contextRef.current.textEnabled) setMessage(result.message);
      setCelebrating(event.state === "CELEBRATE" && contextRef.current.animationAllowed);
    }
  }, []);

  useEffect(() => {
    setAssetFailed(false);
    setEyesFailed(false);
  }, [approvedAsset?.src, approvedAsset?.closedEyesSrc]);

  useEffect(() => {
    let inViewport = false;
    let observed = false;
    const update = () => {
      const currentVisible = inViewport && document.visibilityState === "visible";
      // Invalidate synchronously even if hide/show are batched into one React render.
      if (!currentVisible && liveVisibilityRef.current) generationRef.current += 1;
      liveVisibilityRef.current = currentVisible;
      setVisible(currentVisible);
      if (observed) setVisibilityReady(true);
    };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => { generationRef.current += 1; setReducedMotion(media.matches); };
    updateMotion();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", update);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "function" && rootRef.current) {
      observer = new IntersectionObserver(([entry]) => {
        inViewport = entry.isIntersecting;
        observed = true;
        update();
      }, { threshold: 0 });
      observer.observe(rootRef.current);
    } else {
      inViewport = true;
      observed = true;
      update();
    }
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!visibilityReady) return;
    if (lastEventRef.current === sourceSignature) return;
    lastEventRef.current = sourceSignature;
    setMessage(null);
    setCelebrating(false);
    if (policyRef.current?.scope !== scopeKey) {
      let storage: Storage | null = null;
      try { storage = window.localStorage; } catch { /* Storage failure must not block learning. */ }
      policyRef.current = { scope: scopeKey, policy: createPresentationPolicy(storage, scopeKey) };
    }
    void consumeFeedback({
      state: aoyuState,
      eventId: eventKey ?? `state:${aoyuState}`,
      completionKey,
    }, policyRef.current);
    // Controls or visibility never make an already consumed event into a new event.
  }, [scopeKey, sourceSignature, aoyuState, eventKey, completionKey, visibilityReady, consumeFeedback]);

  useEffect(() => {
    if (!visible) {
      setMessage(null);
      setCelebrating(false);
      setBlinking(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!motion.stateAnimationEnabled) setCelebrating(false);
  }, [motion.stateAnimationEnabled, celebrating]);

  useEffect(() => {
    if (!message && !celebrating) return;
    const timeout = window.setTimeout(() => {
      setMessage(null);
      setCelebrating(false);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [message, celebrating]);

  useEffect(() => {
    setBlinking(false);
    if (!eyesSrc || !motion.blinkEnabled) return;
    const timeouts = new Set<number>();
    const later = (fn: () => void, delay: number) => {
      const id = window.setTimeout(() => { timeouts.delete(id); fn(); }, delay);
      timeouts.add(id);
    };
    const schedule = () => later(() => {
      setBlinking(true);
      later(() => {
        setBlinking(false);
        if (shouldDoubleBlink(Math.random(), reducedMotion)) {
          later(() => {
            setBlinking(true);
            later(() => { setBlinking(false); schedule(); }, BLINK_PARAMETERS.durationMs);
          }, BLINK_PARAMETERS.doubleGapMs);
        } else schedule();
      }, BLINK_PARAMETERS.durationMs);
    }, nextBlinkDelay(Math.random(), reducedMotion));
    schedule();
    // Pause discards all timers; resume begins a fresh quiet interval.
    return () => timeouts.forEach((id) => window.clearTimeout(id));
  }, [eyesSrc, motion.blinkEnabled, reducedMotion]);

  const respondToClick = () => {
    if (!visible || !textEnabled || !policyRef.current || policyRef.current.scope !== scopeKey) return;
    void consumeFeedback({
      state: "ENCOURAGE", eventId: `companion-click:${Date.now()}`,
    }, policyRef.current);
  };

  return (
    <section
      ref={rootRef} className={styles.companion} aria-label="鳌鱼伴学"
      data-aoyu-state={aoyuState}
      data-asset-status={asset ? "APPROVED_V1_1" : "BLOCKED_ASSET"}
      data-blink-status={eyesSrc ? "APPROVED_LAYER" : "UNAVAILABLE"}
      data-progress-status={stage ? "KNOWN" : "UNKNOWN"}
      data-stage={stage?.stage} data-stage-progress={stage?.stageProgress}
      data-motion={motion.pauseAll ? "paused" : reducedMotion ? "reduced" : "active"}
      data-visible={visible} data-reduced-motion={reducedMotion} data-text-enabled={textEnabled}
      data-event-result={eventResult} data-lock-status={lockStatus} data-sound-enabled="false" data-sound-requested={soundEnabled}
    >
      {asset && (
        <button type="button" className={styles.avatarButton} onClick={respondToClick} aria-label="请鳌鱼鼓励我一下">
          <span className={styles.artwork} data-ambient={motion.ambientEnabled} data-celebrating={celebrating && motion.stateAnimationEnabled}>
            <img src={asset.src} alt={asset.alt} width={112} height={112} onError={() => setAssetFailed(true)} />
            {eyesSrc && <img className={styles.eyes} data-blinking={blinking} src={eyesSrc} alt="" aria-hidden="true" width={112} height={112} onError={() => setEyesFailed(true)} />}
          </span>
        </button>
      )}
      <div className={styles.content}>
        <div className={styles.heading}>
          <p className={styles.title}>鳌鱼伴学</p>
          {stage && <span className={styles.stage}>{stage.label} · {stage.progress}%</span>}
        </div>
        <p className={styles.caption}>{STATE_LABELS[aoyuState]}</p>
        <div className={styles.speech} role="status" aria-live="polite" aria-atomic="true">
          {textEnabled && message && <p className={styles.bubble}>{message}</p>}
        </div>
        <div className={styles.controls}>
          {!asset && <button type="button" onClick={respondToClick}>给我一句鼓励</button>}
          {asset && <button type="button" aria-pressed={paused} onClick={() => {
            generationRef.current += 1;
            setPaused((value) => !value);
          }} disabled={!animationEnabled}>{paused ? "继续动画" : "暂停动画"}</button>}
          <button type="button" aria-pressed={!textEnabled} onClick={() => {
            generationRef.current += 1;
            setTextEnabled((value) => !value);
            setMessage(null);
          }}>{textEnabled ? "关闭鼓励文字" : "显示鼓励文字"}</button>
        </div>
      </div>
    </section>
  );
}

export default AoYuCompanion;
