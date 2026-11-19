import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every route that imports `lib/capture` must be listed here, because
  // `playwright-core` reads its own files at run time (browsers.json) and
  // Vercel's file tracing does not find them by itself. The scan-route spec
  // keeps this key in sync with the route path.
  outputFileTracingIncludes: {
    "/api/scan": ["./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
