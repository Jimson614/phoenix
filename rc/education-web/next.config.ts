import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  basePath: "/education",
  images: { unoptimized: true },
  // The repository root also contains WeChat Mini Program pages written as
  // CommonJS `.js`. Next must only treat the TypeScript Web routes as pages.
  pageExtensions: ["ts", "tsx"],
};

export default nextConfig;
