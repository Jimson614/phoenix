import { type Subject, type LearningMode, type HintLevel } from "./engine-types";

export const HINT_LEVELS: Record<number, string> = {
  0: "no hint",
  1: "scope/model hint",
  2: "key-condition hint",
  3: "condition-to-tool question",
  4: "method-category hint",
  5: "first-step hint",
};

export const POLITICS_HINTS: Record<number, string> = {
  0: "不提供直接答案。",
  1: "先回到知识地图：这是一道“同类概念辨析”题，先定位两个概念都属于什么层次？",
  2: "先说出“联系多样性”与“矛盾特殊性”各自的关键条件。",
  3: "你认为哪一个条件最能把这两者分开？（选择后告诉我）",
  4: "只要判断“关系层面的表现”即可：是偏向“多方向并行”还是“矛盾转化后特异化”？",
  5: "第一步只写：我先给出“联系多样性”这个概念的定义主语。",
};

export const MATH_HINTS: Record<number, string> = {
  0: "不提供直接答案。",
  1: "先确认题型：这是“几何方程变代数”类问题，不是纯代数计算题。",
  2: "先写下“直线代入椭圆后得到什么类型的方程？”",
  3: "得到一元二次方程后，核心条件是？（根的关系/判别式/几何几何）",
  4: "你的工具优先级：先代入形成标准一元二次方程，再用什么关系式处理两交点信息？",
  5: "第一步：先把直线表达式代入椭圆方程并整理成标准一元二次。",
};

export function nextHintLevel(previousLevel: number, lastOutcomeCorrect: boolean): HintLevel {
  if (lastOutcomeCorrect) return 0;
  if (previousLevel < 0) return 1;
  if (previousLevel >= 5) return 5;
  return Math.min(5, previousLevel + 1) as HintLevel;
}

function isPolitics(subject: string, topic: string): boolean {
  return (
    subject.toLowerCase().includes("politic") ||
    topic.toLowerCase().includes("联系多样性") ||
    topic.toLowerCase().includes("矛盾特殊性")
  );
}

export function buildHint(
  subject: string,
  topic: string,
  hintLevel: number,
  _learningMode: LearningMode
): string {
  if (hintLevel <= 0) return "";
  if (hintLevel < 0 || hintLevel > 5) hintLevel = 1;

  if (isPolitics(subject, topic) && POLITICS_HINTS[hintLevel]) {
    return POLITICS_HINTS[hintLevel];
  }

  if (topic.toLowerCase().includes("ellipse") || topic.toLowerCase().includes("vieta") || subject.toLowerCase().includes("math")) {
    return MATH_HINTS[hintLevel];
  }

  return isPolitics(subject, topic)
    ? "先从已知条件出发，说明你下一步准备做什么。"
    : "先回到题目条件，判断适合的知识路径。";
}
