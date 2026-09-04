export const BLINK_PARAMETERS = {
  minIntervalMs: 5_800,
  maxIntervalMs: 11_000,
  durationMs: 360,
  doubleProbability: 0.06,
  doubleGapMs: 540,
  // A conservative accessibility cadence; separate from the approved natural cadence.
  reducedMinIntervalMs: 20_000,
  reducedMaxIntervalMs: 30_000,
} as const;

function boundedRandom(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

export function nextBlinkDelay(randomValue: number, reducedMotion = false): number {
  const min = reducedMotion ? BLINK_PARAMETERS.reducedMinIntervalMs : BLINK_PARAMETERS.minIntervalMs;
  const max = reducedMotion ? BLINK_PARAMETERS.reducedMaxIntervalMs : BLINK_PARAMETERS.maxIntervalMs;
  return Math.round(min + boundedRandom(randomValue) * (max - min));
}

export function shouldDoubleBlink(randomValue: number, reducedMotion = false): boolean {
  return !reducedMotion && boundedRandom(randomValue) < BLINK_PARAMETERS.doubleProbability;
}

export function getMotionPolicy(input: { reducedMotion: boolean; visible: boolean; animationEnabled: boolean }) {
  const enabled = input.visible && input.animationEnabled;
  return {
    pauseAll: !enabled,
    blinkEnabled: enabled,
    ambientEnabled: enabled && !input.reducedMotion,
    stateAnimationEnabled: enabled && !input.reducedMotion,
  };
}
