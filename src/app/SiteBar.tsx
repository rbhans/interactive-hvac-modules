import { SITE_HOME } from "@/lib/basePath";

/**
 * When BAS Lab runs inside robboborben.xyz: the same thin bar the site's live demos (Dial,
 * BAS System Map) wear, back to the site's Tools page. A plain link: it's outside this app.
 */
export function SiteBar() {
  if (!SITE_HOME) return null;
  return (
    <nav className="site-bar" aria-label="robboborben.xyz">
      <a className="site-bar-back" href={SITE_HOME} aria-label="Back to Tools on robboborben.xyz">
        <span aria-hidden="true">←</span>
        Tools
      </a>
      <span>BAS Lab · Interactive HVAC lessons</span>
    </nav>
  );
}
