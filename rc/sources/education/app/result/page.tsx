import type { Metadata } from "next";

import { ResultExperience } from "@/components/result-experience";

export const metadata: Metadata = {
  title: "Growth Snapshot",
  description: "你的 Phoenix Compass™ 个性化成长快照。",
};

export default function ResultPage() {
  return <ResultExperience />;
}
