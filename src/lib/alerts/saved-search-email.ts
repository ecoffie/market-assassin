/**
 * Saved-search alert email — the "N new matches for <search>" email the Opportunity Map's
 * "Save search" sends. Each opportunity renders as the app's TARGET CARD, ported to email-safe
 * table HTML (Gmail/Outlook strip flexbox/grid, so no CSS grid — nested tables + inline styles):
 * a colored top strip, a set-aside chip, bold title, agency · location subline, a labeled
 * SET-ASIDE / NAICS / DUE field grid, and a "View details →" footer. (Eric 2026-08-01: "improve
 * the UI like the target card format".)
 *
 * Kept in a lib (not the route) so it's unit-testable + offline-previewable (scripts render the
 * exact HTML) without importing a Next route handler.
 */

export const MINDY_URL = 'https://getmindy.ai';

export type SavedSearchLite = { name: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AlertOpp = Record<string, any>;

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// SAM set_aside_code → short chip label (the app's Target-card set-aside chip). Unknown/empty codes
// get no chip (never invent a set-aside the notice doesn't carry). NULL/'' = full & open → no chip.
export const SET_ASIDE_CHIP: Record<string, string> = {
  '8A': '8(a)', '8AN': '8(a)',
  HZC: 'HUBZone', HZS: 'HUBZone',
  SDVOSBC: 'SDVOSB', SDVOSBS: 'SDVOSB',
  WOSB: 'WOSB', WOSBSS: 'WOSB', EDWOSB: 'EDWOSB', EDWOSBSS: 'EDWOSB',
  VSA: 'VOSB', VSB: 'VOSB',
  SBA: 'Total SB', SBP: 'Partial SB', SDB: 'SDB', ISBEE: 'Buy Indian',
};

/** Title-case a raw uppercase SAM agency string ("DEPT OF DEFENSE" → "Dept of Defense"). */
export function agencyCase(s: string): string {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and').replace(/\bThe\b/g, 'the');
}

export function buildEmail(search: SavedSearchLite, opps: AlertOpp[]): { subject: string; html: string; text: string } {
  const n = opps.length;
  const subject = `${n} new ${n === 1 ? 'match' : 'matches'} for “${search.name}”`;

  const cards = opps.slice(0, 25).map((o) => {
    const loc = [o.pop_city && String(o.pop_city).replace(/\b\w/g, (c: string) => c.toUpperCase()), o.pop_state].filter(Boolean).join(', ');
    const dueDate = o.response_deadline ? new Date(o.response_deadline) : null;
    const dueTxt = dueDate ? dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const daysLeft = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / 86400000) : null;
    const urgent = daysLeft != null && daysLeft >= 0 && daysLeft <= 3;   // ≤3 days → red DUE
    const link = o.ui_link || `${MINDY_URL}/opportunity-map`;
    const chip = SET_ASIDE_CHIP[String(o.set_aside_code || '').toUpperCase()] || '';
    const stripColor = urgent ? '#dc2626' : '#006aff';

    // One labeled field cell (the .st { .k label / .v value } from the app card).
    const cell = (k: string, v: string, red = false) =>
      `<td valign="top" style="padding:0 14px 0 0">
         <div style="font:700 10px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.05em;color:#9aa5b3;text-transform:uppercase">${esc(k)}</div>
         <div style="font:600 14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${red ? '#dc2626' : '#1f2a37'};margin-top:2px">${esc(v)}</div>
       </td>`;

    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 14px">
      <tr><td style="background:${stripColor};border-radius:12px 12px 0 0;height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
      <tr><td style="border:1px solid #e6e9ee;border-top:0;border-radius:0 0 12px 12px;padding:16px 18px">
        ${chip ? `<div style="margin-bottom:8px"><span style="display:inline-block;font:700 11px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b5ed7;background:#eaf2ff;border:1px solid #d4e4ff;border-radius:999px;padding:5px 10px">${esc(chip)}</span></div>` : ''}
        <a href="${esc(link)}" style="display:block;font:700 16px/1.35 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111c26;text-decoration:none">${esc(o.title)}</a>
        <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7787;margin-top:5px">${esc(agencyCase(o.department || 'Federal agency'))}${loc ? ` &middot; ${esc(loc)}` : ''}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px">
          <tr>
            ${cell('Set-aside', chip || 'Full & open')}
            ${cell('NAICS', o.naics_code ? String(o.naics_code) : '—')}
            ${cell('Due', dueTxt + (urgent && daysLeft != null ? ` · ${daysLeft}d` : ''), urgent)}
          </tr>
        </table>
        <div style="margin-top:14px;border-top:1px solid #f0f2f5;padding-top:11px;font:600 12px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif">
          <span style="color:#9aa5b3">${esc(o.solicitation_number || '')}</span>
          <a href="${esc(link)}" style="float:right;color:#006aff;text-decoration:none">View details &rarr;</a>
        </div>
      </td></tr>
    </table>`;
  }).join('');

  const html = `<div style="background:#f5f7fa;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto;padding:0 16px">
      <div style="text-align:center;padding:4px 0 18px">
        <img src="${MINDY_URL}/brand/mindy-logo-3d.png" width="120" alt="Mindy" style="height:auto;border:0;display:inline-block">
      </div>
      <div style="background:#fff;border:1px solid #e6e9ee;border-radius:14px;padding:22px 20px 8px">
        <div style="font:700 12px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.06em;color:#006aff;text-transform:uppercase;margin-bottom:6px">Saved search &middot; ${esc(search.name)}</div>
        <div style="font:800 20px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111c26;margin-bottom:18px">${n} new ${n === 1 ? 'opportunity matches' : 'opportunities match'} your search</div>
        ${cards}
        ${n > 25 ? `<p style="font:500 13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7787;margin:6px 0 16px">+ ${n - 25} more &mdash; <a href="${MINDY_URL}/opportunity-map" style="color:#006aff;text-decoration:none">view all on the map</a></p>` : ''}
        <div style="text-align:center;padding:6px 0 18px">
          <a href="${MINDY_URL}/opportunity-map" style="display:inline-block;background:#006aff;color:#fff;font:700 15px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px 26px;border-radius:10px;text-decoration:none">Open the map</a>
        </div>
      </div>
      <p style="font:500 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9aa5b3;text-align:center;margin:18px 8px 0">
        You saved this search on Mindy. Manage or turn off alerts from the map.<br>Reply to this email for help &middot; GovCon Giants AI
      </p>
    </div>
  </div>`;

  const text = `${n} new ${n === 1 ? 'opportunity matches' : 'opportunities match'} your saved search "${search.name}":\n\n`
    + opps.slice(0, 25).map((o) => {
      const due = o.response_deadline ? new Date(o.response_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      const chip = SET_ASIDE_CHIP[String(o.set_aside_code || '').toUpperCase()];
      return `• ${o.title}\n  ${agencyCase(o.department || '')}${o.naics_code ? ` · NAICS ${o.naics_code}` : ''}${chip ? ` · ${chip}` : ''} · due ${due}`;
    }).join('\n\n')
    + `\n\nOpen the map: ${MINDY_URL}/opportunity-map`;
  return { subject, html, text };
}
