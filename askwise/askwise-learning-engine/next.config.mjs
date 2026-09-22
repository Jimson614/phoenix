/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/askwise",
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default nextConfig;
