import type { AssessmentDraft, Interest } from "@/lib/compass/types";

export type Option<T extends string> = Readonly<{
  value: T;
  label: string;
  detail?: string;
}>;

export const ageOptions = [
  { value: "under_6", label: "5岁及以下" },
  { value: "6_8", label: "6–8岁" },
  { value: "9_11", label: "9–11岁" },
  { value: "12_14", label: "12–14岁" },
  { value: "15_18", label: "15–18岁" },
  { value: "over_18", label: "18岁以上" },
] as const;

export const gradeOptions = [
  { value: "preschool", label: "学前" },
  { value: "primary_1_3", label: "小学 1–3 年级" },
  { value: "primary_4_6", label: "小学 4–6 年级" },
  { value: "junior_secondary", label: "初中 / 中一至中三" },
  { value: "senior_secondary", label: "高中 / 中四至中六" },
  { value: "tertiary", label: "大专 / 本科" },
  { value: "other", label: "其他阶段" },
] as const;

export const locationOptions = [
  { value: "mainland_china", label: "中国内地" },
  { value: "hong_kong", label: "中国香港" },
  { value: "macau", label: "中国澳门" },
  { value: "overseas", label: "海外地区" },
  { value: "other", label: "其他" },
] as const;

export const identityOptions = [
  { value: "mainland_resident", label: "内地居民" },
  { value: "hk_permanent", label: "香港永久性居民" },
  { value: "hk_non_permanent", label: "香港居民（非永久）" },
  { value: "macau_or_overseas", label: "澳门 / 海外身份" },
  { value: "multiple", label: "多地身份情况" },
  { value: "prefer_not_to_say", label: "暂不确定 / 不愿透露" },
] as const;

export const curriculumOptions = [
  { value: "mainland", label: "内地课程", detail: "小学 / 初中 / 普高" },
  { value: "dse", label: "香港本地课程 / DSE" },
  { value: "ib", label: "IB" },
  { value: "a_level", label: "A-Level" },
  { value: "btec", label: "BTEC" },
  { value: "other", label: "其他 / 尚未确定" },
] as const;

export const interestOptions: readonly Option<Interest>[] = [
  { value: "technology", label: "科技与工程", detail: "系统、工具、原理、解决问题" },
  { value: "art", label: "艺术与创意", detail: "视觉、语言、音乐、创作表达" },
  { value: "business", label: "商业与组织", detail: "协作、资源、项目与行动结果" },
  { value: "education", label: "教育与人文", detail: "理解他人、分享知识、连接观点" },
  { value: "health", label: "医疗与生命科学", detail: "生命、健康议题与关怀" },
  { value: "exploring", label: "尚在探索", detail: "先从真实体验中继续观察" },
];

export const familyGoalOptions = [
  { value: "discover_strengths", label: "发现优势信号" },
  { value: "education_direction", label: "明确课程 / 升学方向" },
  { value: "career_exploration", label: "探索专业 / 职业" },
  { value: "global_path", label: "规划香港 / 全球路径" },
  { value: "family_communication", label: "改善学习与家庭沟通" },
  { value: "unsure", label: "暂不确定，先找到起点" },
] as const;

export const stepTitles = [
  "孩子现在处于什么阶段？",
  "孩子目前在哪里学习？",
  "目前主要课程体系是？",
  "孩子目前最愿意投入什么？",
  "你最希望这次探索帮你看清什么？",
] as const;

export function isStepComplete(step: number, draft: AssessmentDraft): boolean {
  switch (step) {
    case 0:
      return Boolean(draft.age_band && draft.grade_band);
    case 1:
      return Boolean(draft.location);
    case 2:
      return Boolean(draft.curriculum);
    case 3:
      return Boolean(draft.interests?.length);
    case 4:
      return Boolean(draft.family_goal);
    default:
      return false;
  }
}
