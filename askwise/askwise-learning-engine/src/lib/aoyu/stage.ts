export type AoyuStage = "YOULIN" | "ZHULIU" | "CHENGLIN" | "LINGBO" | "FEITIAN";

export const AOYU_STAGES = [
  { stage: "YOULIN", label: "幼鳞", min: 0, max: 20 },
  { stage: "ZHULIU", label: "逐流", min: 21, max: 40 },
  { stage: "CHENGLIN", label: "成鳞", min: 41, max: 65 },
  { stage: "LINGBO", label: "凌波", min: 66, max: 85 },
  { stage: "FEITIAN", label: "飞天鳌鱼", min: 86, max: 100 },
] as const;

export interface AoyuStageProgress {
  stage: AoyuStage;
  label: string;
  progress: number;
  min: number;
  max: number;
  stageProgress: number;
}

/** Global progress uses the approved integer 0–100 contract; missing data is not zero. */
export function calculateAoyuStage(progress: number | undefined): AoyuStageProgress | null {
  if (progress === undefined || !Number.isInteger(progress) || progress < 0 || progress > 100) return null;
  const definition = AOYU_STAGES.find((stage) => progress >= stage.min && progress <= stage.max);
  if (!definition) return null;
  return {
    ...definition,
    progress,
    stageProgress: (progress - definition.min) / (definition.max - definition.min),
  };
}
