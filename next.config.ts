import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  devIndicators: false,
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
};
export default nextConfig;
