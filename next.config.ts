import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SYPRUS is a session-driven CRUD application: every portal renders
  // per-user data, so whole-route static caching is switched off deliberately.
  cacheComponents: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
