export const ASSESSMENT_VERSION = "free-mvp-v1.0" as const;
export const RESULT_VERSION = "growth-snapshot-v1.0" as const;

export const AGE_BANDS = [
  "under_6",
  "6_8",
  "9_11",
  "12_14",
  "15_18",
  "over_18",
] as const;

export const GRADE_BANDS = [
  "preschool",
  "primary_1_3",
  "primary_4_6",
  "junior_secondary",
  "senior_secondary",
  "tertiary",
  "other",
] as const;

export const LOCATIONS = ["mainland_china", "hong_kong", "macau", "overseas", "other"] as const;

export const IDENTITY_STATUSES = [
  "mainland_resident",
  "hk_permanent",
  "hk_non_permanent",
  "macau_or_overseas",
  "multiple",
  "prefer_not_to_say",
] as const;

export const CURRICULA = ["mainland", "dse", "ib", "a_level", "btec", "other"] as const;
export const INTERESTS = ["technology", "art", "business", "education", "health", "exploring"] as const;

export const FAMILY_GOALS = [
  "discover_strengths",
  "education_direction",
  "career_exploration",
  "global_path",
  "family_communication",
  "unsure",
] as const;

export type AgeBand = (typeof AGE_BANDS)[number];
export type GradeBand = (typeof GRADE_BANDS)[number];
export type Location = (typeof LOCATIONS)[number];
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];
export type Curriculum = (typeof CURRICULA)[number];
export type Interest = (typeof INTERESTS)[number];
export type FamilyGoal = (typeof FAMILY_GOALS)[number];

export type AssessmentInput = Readonly<{
  assessment_version: typeof ASSESSMENT_VERSION;
  age_band: AgeBand;
  grade_band: GradeBand;
  location: Location;
  identity_status: IdentityStatus;
  curriculum: Curriculum;
  interests: readonly Interest[];
  family_goal: FamilyGoal;
  language: "zh-CN";
}>;

export type AssessmentDraft = Partial<Omit<AssessmentInput, "assessment_version" | "language">>;

export type StrengthSignal = Readonly<{
  title: string;
  evidence: string;
}>;

export type PossibleDirection = Readonly<{
  title: string;
  reason: string;
  micro_action: string;
}>;

export type GrowthSnapshot = Readonly<{
  result_version: typeof RESULT_VERSION;
  growth_type: Readonly<{
    title: string;
    summary: string;
  }>;
  strength_signals: readonly StrengthSignal[];
  possible_directions: readonly PossibleDirection[];
  today_action: string;
  disclaimer: string;
}>;

export type GenerationStatus = "ai" | "fallback";

export type GrowthSnapshotResponse = Readonly<{
  result: GrowthSnapshot;
  generation_status: GenerationStatus;
}>;
