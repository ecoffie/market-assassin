import { SITE_LINK_GROUPS } from '@/lib/seo/site-links';

/** The homepage footer (siteFooterHtml in src/lib/seo/site-links.ts), as JSX. */
export default function PublicFooter() {
  return (
    <footer className="mp-foot" data-mp-chrome="">
      <div className="mp-foot-g">
        {SITE_LINK_GROUPS.map((g) => (
          <div key={g.heading}>
            <h2>{g.heading}</h2>
            <ul>
              {g.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href}>{l.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mp-foot-b">
        Mindy — federal market intelligence built on SAM.gov, USASpending and agency forecast data.
      </div>
    </footer>
  );
}
