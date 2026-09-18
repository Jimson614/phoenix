"use client";

import { useMemo, useState } from "react";

import {
  DIMENSIONS,
  FLOW,
  PERSONAS,
  SKIP_VALUE,
  calculateResult,
  canGeneratePreviewResult,
  canProgressFromStep,
  clamp,
  getNextStepIndex,
  getProgressPercent,
  isConsentBlocked,
  type PersonaId,
} from "./wealth-compass-preview-model";

export default function InternalWealthCompassPreviewPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [appliedPersona, setAppliedPersona] = useState<PersonaId | null>(null);

  const step = FLOW[stepIndex];
  const progress = getProgressPercent(stepIndex);
  const resultFromManual = useMemo(() => calculateResult(answers), [answers]);
  const selectedPersona = appliedPersona ? PERSONAS[appliedPersona] : null;
  const finalDimensions = selectedPersona
    ? DIMENSIONS.map((dimension) => ({
        id: dimension.id,
        label: dimension.label,
        unit: dimension.unit,
        score: selectedPersona.score[dimension.id],
      }))
    : resultFromManual.dimensions;

  const finalTopGaps = selectedPersona ? selectedPersona.topGaps : resultFromManual.topGaps;
  const finalHardRisk = selectedPersona ? appliedPersona === "personaC" : resultFromManual.hardRisk;
  const canProceed = canProgressFromStep(stepIndex, answers);
  const consentBlocked = isConsentBlocked(answers);
  const resultEnabled = canGeneratePreviewResult(answers);

  function pickOption(value: string) {
    setAnswers((current) => ({ ...current, [step.id]: value }));
    setAppliedPersona(null);
  }

  function goNext() {
    if (!canProceed) return;
    setStepIndex((current) => getNextStepIndex(current, answers));
  }

  function goBack() {
    if (stepIndex <= 0) return;
    setStepIndex((current) => current - 1);
  }

  function restart() {
    setStepIndex(0);
    setAnswers({});
    setAppliedPersona(null);
  }

  function applyPersona(persona: PersonaId) {
    setAppliedPersona(persona);
    setAnswers(PERSONAS[persona].answers);
    setStepIndex(FLOW.length - 1);
  }

  const selectedValue = answers[step.id];
  const nextLabel = step.type === "result" ? "" : "下一步";

  return (
    <main style={styles.page}>
      <section style={styles.panel}>
        <header style={styles.header}>
          <div>
            <p style={styles.internalStamp}>INTERNAL PREVIEW</p>
            <h1 style={styles.title}>Wealth Compass 移动端交互测试壳</h1>
            <p style={styles.description}>{step.question}</p>
          </div>
          <span style={styles.badge}>仅内部预览</span>
        </header>

        <div style={styles.noticeWrap}>
          <p>标记：使用模拟数据</p>
          <p>说明：不连接CRM</p>
          <p>说明：不生成真实转介</p>
          <p>说明：不对外发布</p>
        </div>

        <div style={styles.progressWrap} aria-live="polite">
          <div style={styles.progressLabel}>
            <span>流程进度（仅预览）</span>
            <strong>{clamp(progress)}%</strong>
          </div>
          <div style={styles.progressTrack}>
            <span style={{ ...styles.progressFill, width: `${clamp(progress)}%` }} />
          </div>
        </div>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>{step.title}</h2>
          <p style={styles.cardDescription}>{step.description}</p>

          {step.type === "result" ? (
            <>
              <div style={styles.rowTwo} aria-live="polite">
                <p>结果来源：{selectedPersona ? selectedPersona.name : "当前答题路径动态计算"}</p>
                {!selectedPersona ? null : <p style={styles.note}>{selectedPersona.note}</p>}
              </div>

              <div style={styles.resultGrid}>
                {finalDimensions.map((item) => (
                  <article key={item.id} style={styles.resultCard}>
                    <p style={styles.resultTitle}>
                      {item.label}
                      <span>{item.unit}</span>
                    </p>
                    <div style={styles.barBg}>
                      <span
                        style={{
                          ...styles.barFill,
                          width: `${item.score}%`,
                          background: item.score < 35 ? "#ef4444" : "#2563eb",
                        }}
                      />
                    </div>
                    <strong>{item.score}</strong>
                  </article>
                ))}
              </div>

              <div style={styles.subCard}>
                <p style={styles.subTitle}>Top Gaps</p>
                <ul>
                  {finalTopGaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>

              {finalHardRisk ? (
                <div style={styles.riskCard}>
                  <p style={styles.riskTitle}>Hard Risk 人工复核提示</p>
                  <p>当前路径触发高风险复核条件，请在后端策略中接入人工复核池并阻断高风险自动化动作。</p>
                </div>
              ) : null}

              {resultEnabled ? null : (
                <div style={styles.blockHint}>
                  当前分支命中未授权，未开放建议生成功能，仅保留交互与页面结构复核。
                </div>
              )}

              <div style={styles.subCard}>
                <p style={styles.subTitle}>三类 Persona 一键载入</p>
                <div style={styles.personaActions}>
                  {Object.values(PERSONAS).map((persona) => (
                    <button
                      key={persona.id}
                      onClick={() => applyPersona(persona.id)}
                      style={styles.personaButton}
                      type="button"
                    >
                      {persona.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <p style={styles.question}>{step.question}</p>
              <div style={styles.options}>
                {step.options.map((option) => {
                  const isChecked = selectedValue === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => pickOption(option.value)}
                      style={isChecked ? { ...styles.option, ...styles.optionSelected } : styles.option}
                      type="button"
                    >
                      <span>{option.label}</span>
                      {option.help ? <small>{option.help}</small> : null}
                    </button>
                  );
                })}
                {step.allowSkip ? (
                  <button
                    onClick={() => pickOption(SKIP_VALUE)}
                    style={selectedValue === SKIP_VALUE ? { ...styles.option, ...styles.optionSkip } : styles.option}
                    type="button"
                  >
                    暂不回答
                  </button>
                ) : null}
                {step.type === "c2" && step.options.every((item) => item.value !== SKIP_VALUE) ? (
                  <p style={styles.helpText}>选择“不同意”用于模拟授权拦截分支，不进行评分预览。</p>
                ) : null}
              </div>
            </>
          )}

          {step.type === "intro" ? (
            <div style={styles.subCard}>
              <p style={styles.subTitle}>三类 Persona 一键载入</p>
              <div style={styles.personaActions}>
                {Object.values(PERSONAS).map((persona) => (
                  <button
                    key={persona.id}
                    onClick={() => applyPersona(persona.id)}
                    style={styles.personaButton}
                    type="button"
                  >
                    {persona.name}
                  </button>
                  ))}
              </div>
            </div>
          ) : null}

          {consentBlocked ? (
            <p style={styles.blockHint}>
              当前分支命中“未授权”状态，页面用于权限与阻断交互验证，不触发后续建议生成。
            </p>
          ) : null}
        </section>

        <div style={styles.actions}>
          <button disabled={!stepIndex} onClick={goBack} style={styles.secondaryButton} type="button">
            返回修改
          </button>
          {step.type === "result" ? (
            <button onClick={restart} style={styles.primaryButton} type="button">
              重新开始
            </button>
          ) : (
            <button disabled={!canProceed} onClick={goNext} style={styles.primaryButton} type="button">
              {nextLabel}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f7f7fb",
    padding: "1.25rem",
    color: "#0f172a",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  panel: {
    maxWidth: 520,
    margin: "0 auto",
    display: "grid",
    gap: "1rem",
  },
  header: {
    background: "#fef3c7",
    borderRadius: 14,
    padding: "1rem",
    border: "1px solid #f59e0b33",
    boxShadow: "0 6px 24px #0000000d",
  },
  internalStamp: {
    margin: 0,
    color: "#92400e",
    fontWeight: 700,
    letterSpacing: "0.08em",
    fontSize: 12,
  },
  title: {
    margin: "0.2rem 0",
    fontSize: "1.25rem",
  },
  description: {
    margin: 0,
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.5,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "0.8rem",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    background: "#fff7ed",
    borderRadius: 999,
    width: "fit-content",
    padding: "0.3rem 0.8rem",
    fontWeight: 700,
    fontSize: 12,
  },
  noticeWrap: {
    display: "grid",
    gap: 0.4,
    background: "#111827",
    color: "#dbeafe",
    fontSize: 12,
    borderRadius: 12,
    padding: "0.6rem 0.8rem",
    lineHeight: 1.35,
  },
  progressWrap: {
    display: "grid",
    gap: 0.4,
  },
  progressLabel: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#475569",
    fontWeight: 600,
  },
  progressTrack: {
    position: "relative",
    height: 10,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    background: "#16a34a",
    transition: "width 180ms ease",
  },
  card: {
    background: "#ffffff",
    borderRadius: 14,
    padding: "1rem",
    boxShadow: "0 10px 30px #0f172a1a",
    display: "grid",
    gap: "0.8rem",
  },
  cardTitle: {
    margin: 0,
    fontSize: "1.05rem",
  },
  cardDescription: {
    margin: 0,
    color: "#475569",
    fontSize: 14,
    lineHeight: 1.5,
  },
  rowTwo: {
    display: "grid",
    gap: 0.35,
    color: "#334155",
    fontSize: 14,
  },
  note: {
    margin: 0,
    color: "#0ea5e9",
    fontSize: 13,
  },
  question: {
    margin: 0,
    fontWeight: 600,
  },
  options: {
    display: "grid",
    gap: 0.6,
  },
  option: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    background: "#f8fafc",
    textAlign: "left",
    padding: "0.8rem",
    display: "grid",
    gap: 0.2,
    cursor: "pointer",
    color: "#0f172a",
    minHeight: 44,
  },
  optionSelected: {
    borderColor: "#2563eb",
    background: "#eff6ff",
  },
  optionSkip: {
    borderColor: "#f59e0b",
    background: "#fef3c7",
  },
  helpText: {
    margin: "0.1rem 0 0",
    color: "#64748b",
    fontSize: 12,
  },
  blockHint: {
    margin: 0,
    background: "#fee2e2",
    border: "1px solid #fecaca",
    color: "#7f1d1d",
    borderRadius: 8,
    padding: "0.6rem",
    fontSize: 12,
  },
  resultGrid: {
    display: "grid",
    gap: 0.75,
  },
  resultCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "0.7rem",
    background: "#f8fafc",
  },
  resultTitle: {
    margin: 0,
    color: "#0f172a",
    fontSize: 14,
    display: "flex",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  barBg: {
    marginTop: 0.4,
    marginBottom: 0.35,
    height: 8,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
    position: "relative",
  },
  barFill: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    transition: "width 160ms ease",
  },
  subCard: {
    border: "1px dashed #cbd5e1",
    borderRadius: 10,
    padding: "0.7rem",
    display: "grid",
    gap: 0.4,
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.5,
  },
  subTitle: {
    margin: 0,
    color: "#0f172a",
    fontWeight: 700,
    fontSize: 14,
  },
  riskCard: {
    background: "#fee2e2",
    border: "1px solid #fca5a5",
    color: "#7f1d1d",
    borderRadius: 10,
    padding: "0.7rem",
    display: "grid",
    gap: 0.3,
  },
  riskTitle: {
    margin: 0,
    fontWeight: 700,
  },
  personaActions: {
    display: "grid",
    gap: 0.45,
  },
  personaButton: {
    border: "1px solid #2563eb",
    color: "#1d4ed8",
    background: "#e0e7ff",
    borderRadius: 8,
    padding: "0.55rem 0.7rem",
    fontSize: 13,
  },
  actions: {
    display: "grid",
    gap: 0.5,
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    background: "#fff",
    borderRadius: 10,
    padding: "0.75rem",
    minHeight: 44,
    cursor: "pointer",
  },
  primaryButton: {
    border: "1px solid #1d4ed8",
    background: "#2563eb",
    color: "#fff",
    borderRadius: 10,
    padding: "0.75rem",
    minHeight: 44,
    cursor: "pointer",
  },
};

