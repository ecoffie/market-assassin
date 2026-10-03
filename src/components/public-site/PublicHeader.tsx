import { ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '@/app/opportunity-map/account-menu';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import PublicAccountMenu from './PublicAccountMenu';

/** The account script without its <script> wrapper or the trailing build comment. */
const ACCOUNT_MENU_SCRIPT = ACCOUNT_MENU_JS.replace(/^<script>/, '').replace(/<\/script>[\s\S]*$/, '');

/** The homepage header (.zhead in src/app/today/route.ts): same links, logo and account menu. */
export default function PublicHeader() {
  return (
    <header className="mp-head" data-mp-chrome="">
      <nav className="mp-head-left" aria-label="Product">
        <a href="/opportunity-map">Opportunities</a>
        <a href="/opportunity-map?mode=companies">Players</a>
        <a href="/opportunity-map/pursuits">Pursuits</a>
        <a href="/opportunity-map/reports">Markets</a>
      </nav>
      <a href={MAPS_HOME_PATH} title="Mindy" className="mp-logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- the protected brand mark, same file and markup as the homepage */}
        <img src="/brand/mindy-logo-icon.png" alt="" />
        <span>Mindy</span>
      </a>
      <nav className="mp-head-right" aria-label="Account">
        <a href="/bid">Bid with confidence</a>
        <a href="/pricing">Pricing</a>
        <PublicAccountMenu html={ACCOUNT_MENU_HTML} script={ACCOUNT_MENU_SCRIPT} />
      </nav>
    </header>
  );
}
