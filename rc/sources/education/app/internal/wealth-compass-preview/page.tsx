import { notFound } from "next/navigation";

import InternalWealthCompassPreview from "./internal-preview-client";

export default function InternalWealthCompassPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return <InternalWealthCompassPreview />;
}
