"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { durationBucket, trackCompassEvent } from "@/lib/analytics";
import {
  ageOptions,
  curriculumOptions,
  familyGoalOptions,
  gradeOptions,
  identityOptions,
  interestOptions,
  isStepComplete,
  locationOptions,
  stepTitles,
} from "@/lib/compass/questions";
import { createSafeFallback } from "@/lib/compass/result";
import {
  ASSESSMENT_VERSION,
  type AssessmentDraft,
  type AssessmentInput,
  type GrowthSnapshotResponse,
  type Interest,
} from "@/lib/compass/types";
import { validateAssessmentInput, validateGrowthSnapshot } from "@/lib/compass/validation";

const DRAFT_KEY = "pn:free-compass:draft";
const RESULT_KEY = "pn:free-compass:result";
const STARTED_AT_KEY = "pn:free-compass:started-at";

type StoredDraft = Readonly<{
  step: number;
  answers: AssessmentDraft;
}>;

function OptionButton({
  label,
  detail,
  selected,
  onSelect,
  marker,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onSelect: () => void;
  marker?: string;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`answer-option${selected ? " answer-option--selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <span className="answer-option__marker" aria-hidden="true">
        {selected ? "✓" : marker ?? "○"}
      </span>
      <span>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </button>
  );
}

export function AssessmentExperience() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AssessmentDraft>({});
  const [hydrated, setHydrated] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);

  const progress = ((step + 1) / stepTitles.length) * 100;
  const canContinue = isStepComplete(step, draft);
  const selectedInterests = useMemo(() => draft.interests ?? [], [draft.interests]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = sessionStorage.getItem(DRAFT_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as StoredDraft;
          if (parsed && typeof parsed === "object") {
            setStep(Math.min(4, Math.max(0, Number(parsed.step) || 0)));
            setDraft(parsed.answers ?? {});
          }
        }
        const storedStart = Number(sessionStorage.getItem(STARTED_AT_KEY));
        const nextStart = Number.isFinite(storedStart) && storedStart > 0 ? storedStart : Date.now();
        sessionStorage.setItem(STARTED_AT_KEY, String(nextStart));
        setStartedAt(nextStart);
      } catch {
        setDraft({});
        setStep(0);
      } finally {
        setHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, answers: draft } satisfies StoredDraft));
  }, [draft, hydrated, step]);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => setMessageIndex((index) => (index + 1) % 3), 900);
    return () => window.clearInterval(timer);
  }, [generating]);

  function setField<K extends keyof AssessmentDraft>(field: K, value: AssessmentDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function goNext() {
    if (!canContinue) {
      setError("请完成本页必填项后继续。");
      return;
    }
    setStep((current) => Math.min(4, current + 1));
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    if (generating) return;
    setStep((current) => Math.max(0, current - 1));
    setError(null);
  }

  function selectCurriculum(value: AssessmentDraft["curriculum"]) {
    setField("curriculum", value);
    window.setTimeout(() => {
      setStep(3);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 180);
  }

  function toggleInterest(interest: Interest) {
    if (interest === "exploring") {
      setField("interests", ["exploring"]);
      return;
    }
    const withoutExploring = selectedInterests.filter((item) => item !== "exploring");
    if (withoutExploring.includes(interest)) {
      setField(
        "interests",
        withoutExploring.filter((item) => item !== interest),
      );
      return;
    }
    if (withoutExploring.length >= 2) {
      setError("最多选择2个兴趣方向。先取消一个，再继续选择。");
      return;
    }
    setField("interests", [...withoutExploring, interest]);
  }

  async function submitAssessment(nextDraft: AssessmentDraft) {
    if (generating) return;
    const candidate: AssessmentInput = {
      assessment_version: ASSESSMENT_VERSION,
      age_band: nextDraft.age_band!,
      grade_band: nextDraft.grade_band!,
      location: nextDraft.location!,
      identity_status: nextDraft.identity_status ?? "prefer_not_to_say",
      curriculum: nextDraft.curriculum!,
      interests: nextDraft.interests!,
      family_goal: nextDraft.family_goal!,
      language: "zh-CN",
    };
    const inputValidation = validateAssessmentInput(candidate);
    if (!inputValidation.success) {
      setError("回答还不完整，请返回检查后再提交。");
      return;
    }

    setGenerating(true);
    setError(null);
    trackCompassEvent(
      "free_compass_completed",
      { duration_bucket: durationBucket(startedAt) },
      "assessment-completed",
    );

    let envelope: GrowthSnapshotResponse;
    try {
      const response = await fetch("/api/growth-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputValidation.data),
      });
      if (!response.ok) throw new Error("generation_failed");
      const payload = (await response.json()) as GrowthSnapshotResponse;
      const resultValidation = validateGrowthSnapshot(payload.result);
      if (!resultValidation.success || (payload.generation_status !== "ai" && payload.generation_status !== "fallback")) {
        throw new Error("invalid_result");
      }
      envelope = { result: resultValidation.data, generation_status: payload.generation_status };
    } catch {
      envelope = { result: createSafeFallback(inputValidation.data), generation_status: "fallback" };
    }

    sessionStorage.setItem(RESULT_KEY, JSON.stringify(envelope));
    router.push("/result");
  }

  function selectGoal(value: AssessmentDraft["family_goal"]) {
    const nextDraft = { ...draft, family_goal: value };
    setDraft(nextDraft);
    void submitAssessment(nextDraft);
  }

  const generatingMessages = [
    "先理解阶段与环境",
    "再连接兴趣与家庭目标",
    "最后生成可行动的下一步",
  ] as const;

  return (
    <main className="assessment-page" id="main-content">
      <header className="flow-header page-shell">
        <BrandLogo priority />
        <Link className="quiet-link" href="/">
          退出探索
        </Link>
      </header>

      <div className="assessment-layout page-shell">
        <aside className="assessment-context">
          <p className="eyebrow">FREE GROWTH EXPLORATION</p>
          <h1>30秒，找到一个更清楚的起点。</h1>
          <p>没有标准答案。请选择最接近当前情况的选项，所有判断都会保持探索性。</p>
          <div className="privacy-note">
            <strong>本次不会询问</strong>
            <span>姓名、学校、成绩、手机号或证件信息</span>
          </div>
        </aside>

        <section aria-labelledby="question-title" className="question-card">
          <div className="progress-meta">
            <span>成长探索</span>
            <strong>{step + 1} / 5</strong>
          </div>
          <div
            aria-label={`完成进度 ${Math.round(progress)}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progress)}
            className="progress-track"
            role="progressbar"
          >
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="question-body">
            <span className="step-number">0{step + 1}</span>
            <h2 id="question-title">{stepTitles[step]}</h2>
            {step === 0 ? (
              <div className="question-groups">
                <fieldset>
                  <legend>孩子年龄</legend>
                  <div className="option-grid option-grid--compact">
                    {ageOptions.map((option) => (
                      <OptionButton
                        key={option.value}
                        label={option.label}
                        onSelect={() => setField("age_band", option.value)}
                        selected={draft.age_band === option.value}
                      />
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>当前年级</legend>
                  <div className="option-grid option-grid--compact">
                    {gradeOptions.map((option) => (
                      <OptionButton
                        key={option.value}
                        label={option.label}
                        onSelect={() => setField("grade_band", option.value)}
                        selected={draft.grade_band === option.value}
                      />
                    ))}
                  </div>
                </fieldset>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="question-groups">
                <fieldset>
                  <legend>所在地区</legend>
                  <div className="option-grid option-grid--compact">
                    {locationOptions.map((option) => (
                      <OptionButton
                        key={option.value}
                        label={option.label}
                        onSelect={() => setField("location", option.value)}
                        selected={draft.location === option.value}
                      />
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>身份情况 <span>可选</span></legend>
                  <p className="field-help">只用于理解路径条件；可以选择“暂不确定 / 不愿透露”。</p>
                  <div className="option-grid option-grid--compact">
                    {identityOptions.map((option) => (
                      <OptionButton
                        key={option.value}
                        label={option.label}
                        onSelect={() => setField("identity_status", option.value)}
                        selected={draft.identity_status === option.value}
                      />
                    ))}
                  </div>
                </fieldset>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="option-grid">
                {curriculumOptions.map((option) => (
                  <OptionButton
                    detail={"detail" in option ? option.detail : undefined}
                    key={option.value}
                    label={option.label}
                    onSelect={() => selectCurriculum(option.value)}
                    selected={draft.curriculum === option.value}
                  />
                ))}
              </div>
            ) : null}

            {step === 3 ? (
              <>
                <p className="selection-help">最多选择2项。兴趣是观察线索，不代表天赋或职业结论。</p>
                <div className="option-grid">
                  {interestOptions.map((option) => (
                    <OptionButton
                      detail={option.detail}
                      key={option.value}
                      label={option.label}
                      onSelect={() => toggleInterest(option.value)}
                      selected={selectedInterests.includes(option.value)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {step === 4 ? (
              <div className="option-grid">
                {familyGoalOptions.map((option) => (
                  <OptionButton
                    key={option.value}
                    label={option.label}
                    onSelect={() => selectGoal(option.value)}
                    selected={draft.family_goal === option.value}
                  />
                ))}
              </div>
            ) : null}

            <p aria-live="polite" className="form-error">
              {error}
            </p>

            <div className="question-actions">
              <button className="back-button" disabled={step === 0 || generating} onClick={goBack} type="button">
                ← 返回
              </button>
              {step === 0 || step === 1 || step === 3 ? (
                <button className="continue-button" disabled={!canContinue || generating} onClick={goNext} type="button">
                  下一步 <span aria-hidden="true">→</span>
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {generating ? (
        <div aria-live="polite" aria-modal="true" className="generating-overlay" role="dialog">
          <div className="generating-card">
            <div className="compass-loader" aria-hidden="true"><span>✦</span></div>
            <p className="eyebrow">GROWTH SNAPSHOT</p>
            <h2>正在整理孩子的成长信号…</h2>
            <p>{generatingMessages[messageIndex]}</p>
            <small>如果 AI 暂时不可用，我们会立即给出安全版本，不让你失去结果。</small>
          </div>
        </div>
      ) : null}
    </main>
  );
}
