"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { resultVersion, trackCompassEvent } from "@/lib/analytics";
import type { GenerationStatus, GrowthSnapshot } from "@/lib/compass/types";
import { validateGrowthSnapshotResponse } from "@/lib/compass/validation";
import { readSessionItem, removeSessionItems, writeSessionItem } from "@/lib/session-storage";

const RESULT_KEY = "pn:free-compass:result";
const DRAFT_KEY = "pn:free-compass:draft";
const STARTED_AT_KEY = "pn:free-compass:started-at";
const FEEDBACK_KEY = "pn:free-compass:feedback-submitted";

type ResultState = Readonly<{
  result: GrowthSnapshot;
  generationStatus: GenerationStatus;
}>;

export function ResultExperience() {
  const [state, setState] = useState<ResultState | null>(null);
  const [ready, setReady] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = readSessionItem(RESULT_KEY);
        if (!stored) return;
        const validation = validateGrowthSnapshotResponse(JSON.parse(stored));
        if (!validation.success) return;
        const { result, generation_status: generationStatus } = validation.data;
        setState({ result, generationStatus });
        setFeedbackSubmitted(readSessionItem(FEEDBACK_KEY) === "1");
        trackCompassEvent(
          "free_compass_result_viewed",
          { generation_status: generationStatus, result_version: resultVersion },
          "result-viewed",
        );
      } catch {
        setState(null);
      } finally {
        setReady(true);
      }
    });
  }, []);

  function submitFeedback() {
    if (!rating || feedbackSubmitted) return;
    trackCompassEvent("result_helpfulness_submitted", { rating, result_version: resultVersion }, "feedback-submitted");
    writeSessionItem(FEEDBACK_KEY, "1");
    setFeedbackSubmitted(true);
  }

  function resetExperience() {
    removeSessionItems([
      RESULT_KEY,
      DRAFT_KEY,
      STARTED_AT_KEY,
      FEEDBACK_KEY,
      "pn:event:assessment-started",
      "pn:event:assessment-completed",
      "pn:event:result-viewed",
      "pn:event:feedback-submitted",
    ]);
  }

  if (!ready) {
    return (
      <main className="result-page result-page--loading" id="main-content">
        <div className="compass-loader" aria-label="正在读取成长快照"><span>✦</span></div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="result-page" id="main-content">
        <header className="flow-header page-shell"><BrandLogo priority /></header>
        <section className="empty-result page-shell">
          <span className="step-number">!</span>
          <h1>还没有可显示的 Growth Snapshot</h1>
          <p>当前会话中没有找到完整结果。你的回答不会被上传到长期档案。</p>
          <Link className="continue-button" href="/assessment">开始30秒成长探索</Link>
        </section>
      </main>
    );
  }

  const { result, generationStatus } = state;

  return (
    <main className="result-page" id="main-content">
      <header className="flow-header page-shell">
        <BrandLogo priority />
        <span className="result-status">{generationStatus === "ai" ? "AI 已整理" : "安全版本"}</span>
      </header>

      <section className="result-hero">
        <div className="page-shell result-hero__inner">
          <div>
            <p className="eyebrow eyebrow--light">YOUR GROWTH SNAPSHOT</p>
            <h1>{result.growth_type.title}</h1>
            <p>{result.growth_type.summary}</p>
            <span className="exploration-badge">方向快照 · 不是诊断</span>
          </div>
          <div className="result-compass" aria-hidden="true">
            <span>✦</span>
            <small>PHOENIX<br />COMPASS</small>
          </div>
        </div>
      </section>

      <div className="result-content page-shell">
        <section className="result-section">
          <div className="result-section__heading">
            <span>01</span>
            <div><p>STRENGTH SIGNALS</p><h2>目前值得继续观察的信号</h2></div>
          </div>
          <div className="signal-grid">
            {result.strength_signals.map((signal, index) => (
              <article className="signal-card" key={`${signal.title}-${index}`}>
                <span>0{index + 1}</span>
                <h3>{signal.title}</h3>
                <p>{signal.evidence}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="result-section">
          <div className="result-section__heading">
            <span>02</span>
            <div><p>POSSIBLE DIRECTIONS</p><h2>可以从这些方向开始尝试</h2></div>
          </div>
          <div className="direction-list">
            {result.possible_directions.map((direction, index) => (
              <article className="direction-card" key={`${direction.title}-${index}`}>
                <span className="direction-index">0{index + 1}</span>
                <div>
                  <h3>{direction.title}</h3>
                  <p>{direction.reason}</p>
                  <div className="micro-action"><strong>7天微行动</strong><span>{direction.micro_action}</span></div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="today-card">
          <div><p>{"TODAY'S NEXT STEP"}</p><h2>今天就可以做</h2></div>
          <p>{result.today_action}</p>
        </section>

        <section className="feedback-card">
          <div><p>RESULT FEEDBACK</p><h2>这份结果对你有帮助吗？</h2></div>
          {feedbackSubmitted ? (
            <p className="feedback-thanks" role="status">谢谢你的反馈，它会帮助我们改进下一版 Growth Snapshot。</p>
          ) : (
            <div>
              <div aria-label="结果有用度评分" className="rating-row" role="group">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    aria-pressed={rating === value}
                    className={rating === value ? "rating-button rating-button--selected" : "rating-button"}
                    key={value}
                    onClick={() => setRating(value)}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
              <button className="feedback-submit" disabled={!rating} onClick={submitFeedback} type="button">提交反馈</button>
            </div>
          )}
        </section>

        <p className="result-disclaimer">{result.disclaimer}</p>
        {generationStatus === "fallback" ? (
          <p className="fallback-note">本次使用安全规则模板生成；内容仍基于你的回答，未使用推测性个人信息。</p>
        ) : null}
        <Link className="restart-link" href="/assessment" onClick={resetExperience}>重新探索一次</Link>
      </div>
    </main>
  );
}
