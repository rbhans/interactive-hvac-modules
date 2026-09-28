/**
 * Cloudflare Worker for BAS Lab (the static export).
 *
 * It is deployed from this repo on its own (`npm run deploy`) and has no public URL of its own:
 * the personal site forwards robboborben.xyz/tools/bas-lab/* here through a service binding, so
 * BAS Lab ships independently of the site. Every file sits under PREFIX (see scripts/package-site.mjs);
 * static assets are matched first, so this only sees paths no file answers.
 */
// not exported: the runtime treats every export of the entry module as a handler
const PREFIX = "/tools/bas-lab";

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === PREFIX) {
      url.pathname = PREFIX + "/";
      return Response.redirect(url.href, 308);
    }
    if (!url.pathname.startsWith(PREFIX + "/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

export default worker;
