import type { Metadata } from "next";

import { AssessmentExperience } from "@/components/assessment-experience";

export const metadata: Metadata = {
  title: "30秒成长探索",
  description: "通过5个轻量步骤完成 Phoenix Compass™ Free Growth Snapshot。",
};

export default function AssessmentPage() {
  return <AssessmentExperience />;
}
