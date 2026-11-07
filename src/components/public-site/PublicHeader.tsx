import { ACCOUNT_MENU_JS } from '@/app/opportunity-map/account-menu';
import { siteTopHtml } from '@/lib/public-site/site-nav';
import PublicAccountMenu from './PublicAccountMenu';

/** The account script without its <script> wrapper or the trailing build comment. */
const ACCOUNT_MENU_SCRIPT = ACCOUNT_MENU_JS.replace(/^<script>/, '').replace(/<\/script>[\s\S]*$/, '');

/**
 * The site top bar (event banner + homepage nav) from site-nav.ts — the same markup the homepage
 * and the raw-HTML pages emit. PublicAccountMenu only runs the account script against it.
 */
export default function PublicHeader() {
  return (
    <>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: siteTopHtml() }} />
      <PublicAccountMenu html="" script={ACCOUNT_MENU_SCRIPT} />
    </>
  );
}
