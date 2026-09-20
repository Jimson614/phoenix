import { type HintLevel, type KnowledgeLabel, type Subject } from "./engine-types";

const MAX_FIRST_STEP_SAMPLES = 10;

export interface TopicKnowledge {
  attempts: number;
  correctCount: number;
  lastOutcomeCorrect: boolean | null;
  firstStepTimes: number[];
  updatedAt: string | null;
}

export interface AttemptRecord {
  isCorrect: boolean;
  firstStepTime?: number;
}

export interface StudentProfileSnapshot {
  subjectStrengths: Record<string, number>;
  subjectWeaknesses: Record<string, number>;
  knowledgeState: Record<string, Record<string, TopicKnowledge>>;
  hintDependency: Record<string, string[]>;
}

const nowIso = () => new Date().toISOString();

function key(subject: string, topic: string): string {
  return `${subject}:${topic}`;
}

export class StudentProfile {
  name: string;
  subjectStrengths: Record<string, number>;
  subjectWeaknesses: Record<string, number>;
  knowledgeState: Record<string, Record<string, TopicKnowledge>>;
  hintDependency: Record<string, string[]>;
  firstStepTimeHistory: Record<string, number[]>;

  constructor(name = "David") {
    this.name = name;
    this.subjectStrengths = {};
    this.subjectWeaknesses = {};
    this.knowledgeState = {};
    this.hintDependency = {
      "politics:联系多样性 vs 矛盾特殊性": ["概念辨别", "概念关系判断"],
      "math:line-intersects-ellipse-vieta": ["二次方程标准形式", "代入与根的关系"],
    };
    this.firstStepTimeHistory = {};
  }

  private ensureState(subject: Subject, topic: string): TopicKnowledge {
    if (!this.knowledgeState[subject]) {
      this.knowledgeState[subject] = {};
    }
    if (!this.knowledgeState[subject][topic]) {
      this.knowledgeState[subject][topic] = {
        attempts: 0,
        correctCount: 0,
        lastOutcomeCorrect: null,
        firstStepTimes: [],
        updatedAt: null,
      };
    }
    return this.knowledgeState[subject][topic];
  }

  private adjustSubjectProfile(subject: string, correct: boolean) {
    const currentStrength = this.subjectStrengths[subject] ?? 0.5;
    const currentWeakness = this.subjectWeaknesses[subject] ?? 0.5;
    if (correct) {
      this.subjectStrengths[subject] = Math.min(1.0, currentStrength + 0.08);
      this.subjectWeaknesses[subject] = Math.max(0.0, currentWeakness - 0.08);
    } else {
      this.subjectStrengths[subject] = Math.max(0.0, currentStrength - 0.05);
      this.subjectWeaknesses[subject] = Math.min(1.0, currentWeakness + 0.06);
    }
  }

  private topicAccuracy(state: TopicKnowledge): number {
    if (state.attempts === 0) return 0.0;
    return state.correctCount / state.attempts;
  }

  private topicMastery(subject: Subject, topic: string): number {
    const state = this.ensureState(subject, topic);
    const accuracy = this.topicAccuracy(state);
    if (state.attempts === 0) return 0.0;
    let recencyBoost = 0.0;
    if (state.lastOutcomeCorrect === false) recencyBoost = 0.0;
    if (state.lastOutcomeCorrect === true) recencyBoost = 0.2;
    return Math.max(0.0, Math.min(1.0, accuracy * 0.75 + recencyBoost));
  }

  addHintDependency(topicKey: string, prerequisite: string) {
    if (!this.hintDependency[topicKey]) {
      this.hintDependency[topicKey] = [];
    }
    if (!this.hintDependency[topicKey].includes(prerequisite)) {
      this.hintDependency[topicKey].push(prerequisite);
    }
  }

  getHintDependencies(topicKey: string): string[] {
    return this.hintDependency[topicKey] ?? [];
  }

  recordAttempt(subject: Subject, topic: string, correct: boolean, firstStepTime?: number) {
    const state = this.ensureState(subject, topic);
    state.attempts += 1;
    if (correct) {
      state.correctCount += 1;
    }
    state.lastOutcomeCorrect = correct;
    state.updatedAt = nowIso();
    if (firstStepTime !== undefined) {
      const historyKey = key(subject, topic);
      if (!this.firstStepTimeHistory[historyKey]) {
        this.firstStepTimeHistory[historyKey] = [];
      }
      this.firstStepTimeHistory[historyKey].push(firstStepTime);
      if (this.firstStepTimeHistory[historyKey].length > MAX_FIRST_STEP_SAMPLES) {
        this.firstStepTimeHistory[historyKey].shift();
      }
      state.firstStepTimes = this.firstStepTimeHistory[historyKey];
    }
    this.adjustSubjectProfile(subject, correct);
  }

  isUnknown(subject: Subject, topic: string): boolean {
    return this.ensureState(subject, topic).attempts === 0;
  }

  isForgotten(subject: Subject, topic: string): boolean {
    const state = this.ensureState(subject, topic);
    if (state.attempts === 0) return false;
    return this.topicMastery(subject, topic) < 0.45;
  }

  knowledgeLabel(subject: Subject, topic: string): KnowledgeLabel {
    if (this.isUnknown(subject, topic)) return "unknown";
    if (this.isForgotten(subject, topic)) return "forgotten";
    if (this.topicMastery(subject, topic) >= 0.8) return "proficient";
    return "known";
  }
}

export function buildProfileFromAttempts(subject: Subject, topic: string, attempts: AttemptRecord[]): StudentProfile {
  const profile = new StudentProfile();
  attempts.forEach((attempt, index) => {
    profile.recordAttempt(subject, topic, attempt.isCorrect, index === 0 ? attempt.firstStepTime : undefined);
  });
  return profile;
}

export interface ProfileInput {
  subject: Subject;
  topic: string;
  attempts: AttemptRecord[];
}
