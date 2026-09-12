import type { AssessmentInput, GrowthSnapshot } from "@/lib/compass/types";

export type FutureGrowthModuleId =
  | "growth_profile_agent"
  | "growth_pattern_agent"
  | "blueprint_agent"
  | "family_os";

export type GrowthModuleContext = Readonly<{
  assessment: AssessmentInput;
  snapshot: GrowthSnapshot;
}>;

/**
 * Contract-only boundary for future modules. The Free MVP has no implementations,
 * registry, runtime calls, routes, or UI for these modules.
 */
export interface GrowthModuleAdapter<Output = unknown> {
  readonly id: FutureGrowthModuleId;
  run(context: GrowthModuleContext): Promise<Output>;
}
