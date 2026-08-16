/**
 * Saved-search alert email — the "N new matches for <search>" email the Opportunity Map's
 * "Save search" sends. Each opportunity renders as the app's Target card, matched 1:1 to the live
 * `/opportunity-map` card CSS (Eric 2026-08-01), ported to email-safe table HTML (Gmail/Outlook strip
 * flexbox/grid → nested tables + inline styles only). Anatomy, per card:
 *   • a 3px green top rule (the "new match" accent, live .card-rule)
 *   • a chip row: POSTED-ago (green) + notice-type (grey) on the left, a red-dot "N days left" pill
 *     on the right when the deadline is ≤7 days
 *   • bold title (18px/700, -.01em) + a buyer line (bold agency + light location)
 *   • a boxed SET-ASIDE / NAICS / DUE grid — labels 9.5px/700 grey, VALUES 14px/600 (NOT bold),
 *     Due red when urgent (date-only — days-left lives ONLY in the pill, no redundancy)
 *   • a footer: mono regular-weight solicitation# (left) + bold blue "View details →" (right)
 *
 * Colors are the live card's tokens (#0f1e2e ink / #516074 / #8b98a8 / #e4e9ee hairline /
 * #f7f9fb fact-box / #0a8f57 green / #e0322f red / #006aff blue). Kept in a lib (not the route) so
 * it's unit-testable + offline-previewable without importing a Next route handler.
 */

export const MINDY_URL = 'https://getmindy.ai';

// `id` is required for the map deep link (?ss=<id>). It was previously omitted, so the id was
// discarded at the type boundary even though the cron selects it and passes the whole row —
// every "Open the map" CTA landed on the unfiltered national map instead of the saved search.
// Optional so name-only callers (offline previews) still compile; mapHref() degrades honestly.
export type SavedSearchLite = { id?: string; name: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AlertOpp = Record<string, any>;

/**
 * Every map link in this email, built in ONE place so the CTAs cannot drift apart.
 *
 * `?ss=<id>` is read by the map at boot (opportunity-map/route.ts ~7165), which loads the
 * search and runs it through __applySavedSearch — the SAME restorer the in-map picker uses.
 * `?opp=<notice_id>` is applied by an independent IIFE (~7110), so the two compose: the
 * drawer opens on that notice while the map behind it stays narrowed to the search.
 *
 * No id (older/preview callers) → a bare map link rather than a broken `ss=undefined`.
 *
 * ⚠️ `amp` is not cosmetic. Card hrefs are run through esc() at render, which re-escapes the
 * `&` in `&amp;` and ships `&amp;amp;` — a URL that breaks the deep link. So: pass the RAW '&'
 * for anything esc() will touch (cards, plain text) and the default '&amp;' for hrefs
 * interpolated straight into HTML. A unit test pins both shapes.
 */
export function mapHref(search: SavedSearchLite, noticeId?: string, amp = '&amp;'): string {
  const qs: string[] = [];
  if (noticeId) qs.push(`opp=${encodeURIComponent(String(noticeId))}`);
  if (search.id) qs.push(`ss=${encodeURIComponent(String(search.id))}`);
  if (search.id) qs.push('src=saved_search_alert');
  return `${MINDY_URL}/opportunity-map${qs.length ? `?${qs.join(amp)}` : ''}`;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// SAM set_aside_code → short label (the Target-card set-aside VALUE). Unknown/empty → "Full & open"
// (never invent a set-aside the notice doesn't carry).
export const SET_ASIDE_CHIP: Record<string, string> = {
  '8A': '8(a)', '8AN': '8(a)',
  HZC: 'HUBZone', HZS: 'HUBZone',
  SDVOSBC: 'SDVOSB', SDVOSBS: 'SDVOSB',
  WOSB: 'WOSB', WOSBSS: 'WOSB', EDWOSB: 'EDWOSB', EDWOSBSS: 'EDWOSB',
  VSA: 'VOSB', VSB: 'VOSB',
  SBA: 'Total SB', SBP: 'Partial SB', SDB: 'SDB', ISBEE: 'Buy Indian',
};

// `sam_opportunities.notice_type` is stored as the full human label already ("Combined
// Synopsis/Solicitation", "Solicitation", "Sources Sought", …), NOT a code — so the notice chip just
// displays it, only shortening the one long value so it fits the chip. Empty → no chip (never invent).
const NOTICE_TYPE_SHORTEN: Record<string, string> = {
  'Combined Synopsis/Solicitation': 'Combined Synopsis/Sol.',
  'Consolidate/(Substantially) Bundle': 'Bundle Notice',
  'Sale of Surplus Property': 'Surplus Sale',
};
export function noticeTypeLabel(raw: string | null | undefined): string {
  const v = String(raw || '').trim();
  if (!v) return '';
  return NOTICE_TYPE_SHORTEN[v] || v;
}

/** Title-case a raw uppercase SAM agency string ("DEPT OF DEFENSE" → "Dept of Defense"). */
export function agencyCase(s: string): string {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and').replace(/\bThe\b/g, 'the');
}

function fmtDate(iso: string): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

/** "Posted N days ago" (the green chip). Falls back to a date if the post is >30 days old. */
export function postedAgo(iso: string | null | undefined): string {
  if (!iso) return 'Recently posted';
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return 'Posted today';
  if (d === 1) return 'Posted 1 day ago';
  if (d <= 30) return `Posted ${d} days ago`;
  return `Posted ${fmtDate(iso)}`;
}

const FONT = "-apple-system,Segoe UI,Roboto,Arial,sans-serif";

// A rectangular chip (live .tag: radius 6px, 10.5px/700, .03em, UPPERCASE).
function chip(txt: string, color: string, bg: string): string {
  return `<span style="display:inline-block;font:700 10.5px/1 ${FONT};letter-spacing:.03em;text-transform:uppercase;color:${color};background:${bg};border:1px solid ${bg};border-radius:6px;padding:4px 9px;margin:0 6px 6px 0;white-space:nowrap">${esc(txt)}</span>`;
}

// One boxed-grid cell (live .fc): label .k = 9.5px/700 grey, value .v = 14px/600 (NOT bold), due = red.
function cell(k: string, v: string, red: boolean, first: boolean): string {
  return `<td valign="top" width="33.33%" style="padding:10px 12px;${first ? '' : 'border-left:1px solid #e4e9ee;'}">
    <div style="font:700 9.5px/1.3 ${FONT};letter-spacing:.05em;color:#8b98a8;text-transform:uppercase">${esc(k)}</div>
    <div style="font:600 14px/1.4 ${FONT};color:${red ? '#e0322f' : '#0f1e2e'};margin-top:3px">${esc(v)}</div>
  </td>`;
}

function renderCard(o: AlertOpp, last: boolean, search: SavedSearchLite): string {
  const loc = [o.pop_city && String(o.pop_city).replace(/\b\w/g, (c: string) => c.toUpperCase()), o.pop_state].filter(Boolean).join(', ');
  const dueTxt = fmtDate(o.response_deadline) || '—';
  const daysLeft = o.response_deadline ? Math.ceil((new Date(o.response_deadline).getTime() - Date.now()) / 86400000) : null;
  const urgent = daysLeft != null && daysLeft >= 0 && daysLeft <= 7;
  // Open the notice INSIDE the map (drawer), carrying the saved search so the map behind it
  // stays narrowed. Previously `o.ui_link` sent the reader to SAM.gov — out of the product on
  // the single highest-intent click in the email. The SAM link still lives on the drawer.
  const link = o.notice_id ? mapHref(search, o.notice_id, '&') : (o.ui_link || mapHref(search, undefined, '&'));
  const sa = SET_ASIDE_CHIP[String(o.set_aside_code || '').toUpperCase()] || '';
  const noticeLabel = noticeTypeLabel(o.notice_type);

  const postedChip = chip(postedAgo(o.posted_date), '#0f7a4d', '#e8f6ee');
  const noticeChip = noticeLabel ? chip(noticeLabel, '#516074', '#e4e9ee') : '';
  const urgencyChip = urgent
    ? `<span style="display:inline-block;font:700 10.5px/1 ${FONT};letter-spacing:.03em;text-transform:uppercase;color:#e0322f;background:#fdecec;border:1px solid #fdecec;border-radius:6px;padding:4px 9px;white-space:nowrap"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#e0322f;vertical-align:middle;margin-right:5px"></span>${daysLeft} day${daysLeft === 1 ? '' : 's'} left</span>`
    : '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0">
    <tr><td style="background:#0a8f57;border-radius:14px 14px 0 0;height:3px;line-height:3px;font-size:0">&nbsp;</td></tr>
    <tr><td style="border:1px solid #e4e9ee;border-top:0;border-radius:0 0 14px 14px;padding:15px 18px;background:#fff">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="vertical-align:middle">${postedChip}${noticeChip}</td>
        <td align="right" style="vertical-align:middle;white-space:nowrap">${urgencyChip}</td>
      </tr></table>
      <a href="${esc(link)}" style="display:block;font:700 18px/1.2 ${FONT};letter-spacing:-.01em;color:#0f1e2e;text-decoration:none;margin-top:9px">${esc(o.title)}</a>
      <div style="font:400 13.5px/1.4 ${FONT};color:#516074;margin-top:3px"><span style="font-weight:600;color:#0f1e2e">${esc(agencyCase(o.department || 'Federal agency'))}</span>${loc ? ` &middot; <span style="color:#8b98a8">${esc(loc)}</span>` : ''}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:13px;border:1px solid #e4e9ee;border-radius:10px;background:#f7f9fb">
        <tr>
          ${cell('Set-aside', sa || 'Full & open', false, true)}
          ${cell('NAICS', o.naics_code ? String(o.naics_code) : '—', false, false)}
          ${cell('Due', dueTxt, urgent, false)}
        </tr>
      </table>
      <div style="margin-top:14px">
        <span style="font:400 11px/1 'IBM Plex Mono',ui-monospace,Menlo,monospace;color:#8b98a8">${esc(o.solicitation_number || '')}</span>
        <a href="${esc(link)}" style="float:right;font:700 13px/1 ${FONT};color:#006aff;text-decoration:none">View details &rarr;</a>
      </div>
    </td></tr>
  </table>${last ? '' : '<div style="height:20px;line-height:20px;font-size:0">&nbsp;</div>'}`;
}

export function buildEmail(search: SavedSearchLite, opps: AlertOpp[]): { subject: string; html: string; text: string } {
  const n = opps.length;
  const subject = `${n} new ${n === 1 ? 'match' : 'matches'} for “${search.name}”`;

  const shown = opps.slice(0, 25);
  const cards = shown.map((o, i) => renderCard(o, i === shown.length - 1, search)).join('');

  const html = `<div style="background:#f3f5f7;padding:24px 0;font-family:${FONT}">
    <div style="max-width:460px;margin:0 auto;padding:0 16px">
      <div style="text-align:center;padding:4px 0 18px">
        <img src="${MINDY_URL}/brand/mindy-logo-3d.png" width="120" alt="Mindy" style="height:auto;border:0;display:inline-block">
      </div>
      <div style="font:700 12px/1 ${FONT};letter-spacing:.06em;color:#006aff;text-transform:uppercase;margin-bottom:6px;padding:0 4px">Saved search &middot; ${esc(search.name)}</div>
      <div style="font:800 22px/1.3 ${FONT};color:#0f1e2e;margin:0 0 20px;padding:0 4px">${n} new ${n === 1 ? 'opportunity matches' : 'opportunities match'} your search</div>
      ${cards}
      ${n > 25 ? `<p style="font:500 13px/1.5 ${FONT};color:#516074;margin:16px 4px 0">+ ${n - 25} more &mdash; <a href="${mapHref(search)}" style="color:#006aff;text-decoration:none">view all on the map</a></p>` : ''}
      <div style="text-align:center;padding:26px 0 8px">
        <a href="${mapHref(search)}" style="display:inline-block;background:#006aff;color:#fff;font:700 15px/1 ${FONT};padding:14px 28px;border-radius:10px;text-decoration:none">Open the map</a>
      </div>
      <p style="font:500 12px/1.6 ${FONT};color:#8b98a8;text-align:center;margin:14px 8px 0">
        You saved this search on Mindy. Manage or turn off alerts from the map.<br>Reply to this email for help &middot; GovCon Giants AI
      </p>
    </div>
  </div>`;

  const text = `${n} new ${n === 1 ? 'opportunity matches' : 'opportunities match'} your saved search "${search.name}":\n\n`
    + shown.map((o) => {
      const due = o.response_deadline ? fmtDate(o.response_deadline) : '—';
      const sa = SET_ASIDE_CHIP[String(o.set_aside_code || '').toUpperCase()];
      const nt = noticeTypeLabel(o.notice_type);
      return `• ${o.title}\n  ${agencyCase(o.department || '')}${o.naics_code ? ` · NAICS ${o.naics_code}` : ''}${sa ? ` · ${sa}` : ''}${nt ? ` · ${nt}` : ''} · due ${due}`;
    }).join('\n\n')
    + `\n\nOpen the map: ${mapHref(search, undefined, '&')}`;
  return { subject, html, text };
}
