/**
 * The scrolling "Built on the official federal record" logo strip — the same logos and motion as
 * the homepage (src/app/home/page.tsx, public/home/logos/). Two copies of the list scroll as one
 * loop; hover pauses it; reduced motion shows one static, wrapped row.
 */
const LOGOS: Array<[src: string, alt: string, ratio: number]> = [
  ['/home/logos/sam-gov.webp', 'SAM.gov', 4.875],
  ['/home/logos/usaspending-gov.webp', 'USASpending.gov', 9.273],
  ['/home/logos/grants-gov.webp', 'Grants.gov', 2.977],
  ['/home/logos/gsa-acquisition-gateway-agency-forecasts.webp', 'GSA Acquisition Gateway — agency forecasts', 3.261],
  ['/home/logos/federal-register.webp', 'Federal Register', 4.159],
  ['/home/logos/u-s-small-business-administration.webp', 'U.S. Small Business Administration', 3.568],
];

export default function LogoMarquee({ title = 'Built on the official federal record' }: { title?: string }) {
  const list = (hidden: boolean) => (
    <ul className="lm-track" aria-hidden={hidden || undefined}>
      {LOGOS.map(([src, alt, ratio]) => (
        <li key={src}>
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logos, same files as the homepage */}
          <img src={src} alt={hidden ? '' : alt} style={{ aspectRatio: String(ratio) }} loading="lazy" />
        </li>
      ))}
    </ul>
  );
  return (
    <section className="lm" aria-label="Data sources">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h2>{title}</h2>
      <div className="lm-row">{list(false)}{list(true)}</div>
    </section>
  );
}

const CSS = `
.lm{margin:72px 0 0;text-align:center}
.lm h2{font-family:var(--mp-font-serif);font-weight:700;font-size:clamp(24px,3vw,34px);margin:0 0 28px;color:var(--mp-ink)}
.lm-row{display:flex;overflow:hidden;width:100%}
.lm-track{list-style:none;display:flex;flex:none;gap:16px;margin:0;padding:0 8px;animation:lm-scroll 32s linear infinite}
.lm-row:hover .lm-track{animation-play-state:paused}
.lm-track li{display:flex;align-items:center;justify-content:center;width:236px;height:72px;padding:14px 26px}
.lm-track img{width:auto;height:auto;max-width:184px;max-height:44px;display:block}
@keyframes lm-scroll{from{transform:translateX(0)}to{transform:translateX(-100%)}}
@media (max-width:620px){.lm-track li{width:168px;height:60px;padding:10px 16px}.lm-track img{max-width:136px;max-height:34px}.lm-track{gap:4px}}
@media (prefers-reduced-motion: reduce){.lm-track{animation:none}.lm-row{flex-wrap:wrap;justify-content:center}.lm-track[aria-hidden]{display:none}.lm-track{flex-wrap:wrap;justify-content:center}}
`;
