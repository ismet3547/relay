import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    "/*": ["./.venv/**/*", "./.relay-data/**/*", "./.demo-data/**/*"],
  },
};
export default config;
