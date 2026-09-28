/**
 * Where the app is served. In dev it's the site root; on robboborben.xyz it's /tools/bas-lab
 * (set at build time by `npm run deploy`, see next.config.ts).
 *
 * next/link adds the base path on its own. Files fetched by URL (GLBs, baked airflow fields) don't,
 * so they go through `asset()`.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const asset = (path: string) => `${BASE_PATH}${path}`;

/** The host site's page to return to (its Tools page), when BAS Lab is embedded in one */
export const SITE_HOME = process.env.NEXT_PUBLIC_SITE_HOME || null;
