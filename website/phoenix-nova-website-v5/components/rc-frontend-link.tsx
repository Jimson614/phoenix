import type { ComponentProps } from "react";

// The Education renderer has a separate Next.js router and asset manifest.
// Crossing this boundary requires a document navigation through the RC gateway.
export function FrontendLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}
