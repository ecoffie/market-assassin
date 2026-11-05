import { ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '@/app/opportunity-map/account-menu';
// The public-site logo goes to the marketing homepage (getmindy.ai/), not MAPS_HOME_PATH
// (Today's Intel), since 2026-11-05.
const SITE_HOME_PATH = '/';
import { MP_HEADER_ACCOUNT_LINKS, MP_HEADER_PRODUCT_LINKS, MP_LOGO_SRC } from '@/lib/public-site/chrome';
import PublicAccountMenu from './PublicAccountMenu';

/** The account script without its <script> wrapper or the trailing build comment. */
const ACCOUNT_MENU_SCRIPT = ACCOUNT_MENU_JS.replace(/^<script>/, '').replace(/<\/script>[\s\S]*$/, '');

/** The homepage header (.zhead in src/app/today/route.ts): same links, logo and account menu. */
export default function PublicHeader() {
  return (
    <header className="mp-head" data-mp-chrome="">
      <nav className="mp-head-left" aria-label="Product">
        {MP_HEADER_PRODUCT_LINKS.map((l) => (
          <a key={l.href} href={l.href}>{l.label}</a>
        ))}
      </nav>
      <a href={SITE_HOME_PATH} title="Mindy" className="mp-logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- the protected brand mark, same file and markup as the homepage */}
        <img src={MP_LOGO_SRC} alt="" />
        <span>Mindy</span>
      </a>
      <nav className="mp-head-right" aria-label="Account">
        {MP_HEADER_ACCOUNT_LINKS.map((l) => (
          <a key={l.href} href={l.href}>{l.label}</a>
        ))}
        <PublicAccountMenu html={ACCOUNT_MENU_HTML} script={ACCOUNT_MENU_SCRIPT} />
      </nav>
    </header>
  );
}
