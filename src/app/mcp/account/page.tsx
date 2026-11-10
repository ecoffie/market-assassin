import { redirect } from 'next/navigation';

/**
 * /mcp/account → the app's Settings page (Eric, 2026-11-10: "everything under the same settings
 * page"). The console now lives in Settings → Credits & usage (src/components/account/CreditsConsole.tsx).
 *
 * This address is still in receipts, Stripe return URLs (auto-recharge), team-invite emails and
 * older links, so it redirects and keeps every parameter: ?section=<tab> becomes ?tab=<tab>
 * (the app's ?section= picks the Settings card), and autorecharge / topup / invite pass through.
 */
export default async function McpAccountRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const out = new URLSearchParams({ panel: 'settings', section: 'credits' });
  for (const [k, v] of Object.entries(raw)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val !== 'string' || !val) continue;
    if (k === 'panel') continue;
    if (k === 'section') {
      if (val !== 'settings') out.set('tab', val);
      continue;
    }
    out.set(k, val);
  }
  redirect(`/app?${out.toString()}`);
}
