import createMDX from "@next/mdx";
import type { NextConfig } from "next";

// `npm run deploy` builds a static export served under robboborben.xyz/tools/bas-lab (EXPORT=1,
// BASE_PATH=/tools/bas-lab, SITE_HOME=/tools). Dev and plain builds stay at the root.
const exporting = process.env.EXPORT === "1";
const basePath = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  transpilePackages: ["three"],
  // lets a production build run alongside `next dev` (NEXT_DIST_DIR=.next-build npm run build)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // there's a stray lockfile in the home directory; pin tracing and Turbopack to this project
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
  // trailing slashes keep every request under the base path: without them the home page's
  // payload is fetched from `${basePath}.txt`, a sibling of the app's folder, not inside it
  ...(exporting ? { output: "export" as const, trailingSlash: true } : {}),
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_HOME: process.env.SITE_HOME ?? "",
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
