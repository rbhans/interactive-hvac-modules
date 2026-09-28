import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  transpilePackages: ["three"],
  // lets a production build run alongside `next dev` (NEXT_DIST_DIR=.next-build npm run build)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // there's a stray lockfile in the home directory; pin tracing and Turbopack to this project
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
