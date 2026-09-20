import { type Subject, type LearningModeDecision, type LearningMode as LearningModeType } from "./engine-types";
import { StudentProfile } from "./learning";
import type { DiagnosisResult } from "./engine-types";

export const LearningMode = {
  TEACHING: "Teaching Mode",
  RECALL: "Recall Mode",
  TRANSFER: "Transfer Mode",
  THINKING: "Thinking Mode",
  DEBUG: "Debug Mode",
} as const;

export type LearningMode = LearningModeType;

export function chooseLearningMode(
  profile: StudentProfile,
  subject: Subject,
  topic: string,
  diagnosis: DiagnosisResult
): LearningModeDecision {
  if (profile.isUnknown(subject, topic)) {
    return { mode: LearningMode.TEACHING, rationale: "未出现该主题的历史解题轨迹，先补齐概念图谱。" };
  }

  if (profile.isForgotten(subject, topic)) {
    return {
      mode: LearningMode.RECALL,
      rationale: "有过接触但近期掌握度不稳，先触发记忆召回。",
    };
  }

  if (diagnosis.errorType === null) {
    return {
      mode: LearningMode.TRANSFER,
      rationale: "回答已具备核心思路，可继续迁移到完整解答。",
    };
  }

  if (diagnosis.executionError) {
    return {
      mode: LearningMode.DEBUG,
      rationale: "推理方向正确但执行有误，需要定位计算或代数步骤问题。",
    };
  }

  if (!diagnosis.methodSelected) {
    return {
      mode: LearningMode.THINKING,
      rationale: "当前尚未确认可复用的方法路径，需要重新选择方法。",
    };
  }

  if (diagnosis.correctReasoning) {
    return {
      mode: LearningMode.TRANSFER,
      rationale: "能应用到题目框架，但仍需从概念迁移到步骤。",
    };
  }

  return { mode: LearningMode.RECALL, rationale: "先纠正识别错误，补齐该知识类型的调用方式。" };
}
