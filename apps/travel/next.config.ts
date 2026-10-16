import type { NextConfig } from "next";

const config: NextConfig = {
  // The guard and adapter are workspace TypeScript sources, so Next compiles them.
  transpilePackages: ["@genui-guard/core", "@genui-guard/json-render"],
};

export default config;
