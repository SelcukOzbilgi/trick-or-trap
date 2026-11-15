import nextConfig from "eslint-config-next";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextConfig,
  {
    rules: {
      // Enforce "Possible" prefix on finding titles is a runtime Zod concern,
      // not a lint rule — no extra rules needed here beyond eslint-config-next.
    },
  },
];

export default config;
