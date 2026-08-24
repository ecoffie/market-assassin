/**
 * Email strip for "Today's Lens" — the map hook, in the inbox.
 *
 * Renders the SAME grounded lens the app hero shows (computeTodaysLens) as an email-safe HTML block
 * for the daily alert email. Pure function: it FORMATS an already-computed lens — no async, no DB.
 * Deterministic.
 *
 * NO EMOJI. The app hero uses emoji strand icons, but Eric's standing rule is NO emoji in Mindy UI,
 * and email clients render emoji inconsistently. We use the strand LABEL only and ignore `strand.icon`.
 *
 * GROUND IN REAL DATA: grounded blocks show the strand's REAL count. A quiet day (no open opps)
 * fabricates NO counts — it offers the whole map with an honest one-liner and no numbers.
 */

import type { TodaysLens } from '@/lib/dashboard/todays-lens';

// Mindy navy→purple button (matches the existing alert email CTA palette).
const BUTTON_STYLE =
  'display:inline-block;background:#1e3a8a;background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%);' +
  'color:#ffffff;padding:11px 22px;border-radius:999px;font-weight:700;font-size:13px;text-decoration:none;';

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render the Today's Lens block for the daily alert email.
 *
 * @param lens    The already-computed lens (from computeTodaysLens).
 * @param baseUrl e.g. "https://getmindy.ai" — the map link's origin.
 * @param trackedUrl Optional click-tracker wrapper (the SAME one every other alert-email link uses —
 *   appends campaign=daily_alert UTM + a redirect that logs the click). Passing it is what makes the
 *   email→map click VISIBLE (recorded) and the map arrival attributable (utm_source), so Mission
 *   Control's "daily alert → map reach" ratio fills in for this button. Omit → a raw link (tests /
 *   previews). Signature matches the file's other renderers: (url, label, content?) => string.
 * @returns       An email-safe HTML string (a <table> block, inline styles only).
 */
export function renderTodaysLensEmailBlock(
  lens: TodaysLens,
  baseUrl: string,
  trackedUrl?: (url: string, label: string, content?: string) => string,
): string {
  // Wrap through the click-tracker when provided; else the raw url (unit tests assert on the raw form).
  const wrap = (url: string, label: string) => (trackedUrl ? trackedUrl(url, label, label) : url);
  const grounded = lens.grounded && lens.totalOpen > 0 && lens.strands.length > 0;

  if (!grounded) {
    // Quiet day — NO fabricated counts. Honest one-liner + the whole map (no strategy filter).
    const mapUrl = wrap(`${baseUrl}/opportunity-map?src=alert`, 'todays_lens_map_quiet');
    return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;border-collapse:separate;">
    <tr>
      <td style="background:#0f172a;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:12px;padding:22px 24px;text-align:center;">
        <p style="color:#a5b4fc;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px 0;">Explore The Map</p>
        <p style="color:#e2e8f0;font-size:14px;line-height:1.5;margin:0 0 16px 0;">The market moves daily — explore the whole map.</p>
        <a href="${mapUrl}" style="${BUTTON_STYLE}">Open the Map &rarr;</a>
      </td>
    </tr>
  </table>`;
  }

  // Grounded — one row per PRESENT strand, right-aligned tabular count. Label only, NO emoji/icon.
  // ONE lead strand carries the headline; the rest are a quiet supporting line.
  // A flat five-row table of numbers (the previous design) gave the reader no reason to
  // care about 1,021 vs 309 — every row shouted equally, so none of them landed.
  const ranked = [...lens.strands].sort((a, b) => (b.count || 0) - (a.count || 0));
  const lead = ranked[0];
  // ALL strands ride the supporting line now. Promoting one into a headline is what
  // produced "1,037 repeat buyers in your markets" — a sentence that reads as a count of
  // ORGANIZATIONS. As a labelled chip ("1,037 Repeat Buyer") the number is unambiguous.
  const rest = ranked.filter((s) => (s.count || 0) > 0);

  const restLine = rest.length
    ? `<p style="color:#64748b;font-size:13px;line-height:1.6;margin:8px 0 0 0;">${rest
        .map(
          (s) =>
            `<span style="white-space:nowrap;"><strong style="color:#334155;font-variant-numeric:tabular-nums;">${s.count.toLocaleString('en-US')}</strong> ${esc(s.label.replace(/s$/, ''))}</span>`
        )
        .join('<span style="color:#cbd5e1;"> &nbsp;·&nbsp; </span>')}</p>`
    : '';

  const mapUrl = wrap(`${baseUrl}/opportunity-map?strategy=${encodeURIComponent(lens.lensStrategy)}&src=alert`, 'todays_lens_map');

  // Naming what is on the other side of the click converts better than a bare "Open Today's Map".
  // MUST be lens.totalOpen — the single real count from computeTodaysLens. Do NOT sum the strands:
  // they OVERLAP (one notice can be both Set-Aside and Close This Week), so a sum inflates the
  // number and would put a fabricated figure in front of the user. Caught in preview 2026-08-17:
  // the strands summed to 2,427 against a true totalOpen of 2,127.
  const totalLabel = (Number(lens.totalOpen) || 0).toLocaleString('en-US');

  // LIGHT card on a white body — the previous version was a second dark slab stacked
  // straight under the dark header, so the two read as one heavy wall (Eric 2026-08-19:
  // "the hero is still ugly block"). A light card with one accent rule separates them.
  const leadCount = (lead?.count || 0).toLocaleString('en-US');

  // A CTA COUNT AND ITS DESTINATION MUST DESCRIBE THE SAME POPULATION.
  //
  // This said "Explore all 830 in this market" while linking to ?strategy=<top 3 strands>,
  // which the map applies with .contains() = has ALL THREE. Measured 2026-08-23 on a 541
  // market: 830 promised, 77 delivered. Both numbers were correct for their own query; the
  // CTA was the lie, because "all N" claimed they described one population.
  //
  // Fixed by naming BOTH, not by forcing them to match — the section header is "Your market
  // at a glance", so the market total is the right thing to lead with. The strategy slice is
  // the useful narrowing, and saying so turns an apparent contradiction into intelligence.
  //
  // lensCount is null when the count failed. Then the CTA drops the number rather than
  // guessing — an unnumbered link is honest, a wrong number is not.
  const lensN = lens.lensCount;
  const lensLine = (typeof lensN === 'number' && lensN > 0 && lensN < (Number(lens.totalOpen) || 0))
    ? `<p style="color:#475569;font-size:14px;font-weight:700;line-height:1.45;margin:6px 0 0 0;">${lensN.toLocaleString('en-US')} match today's recommended strategies</p>`
    : '';
  const ctaLabel = (typeof lensN === 'number' && lensN > 0)
    ? `Explore ${lensN.toLocaleString('en-US')} recommended`
    : 'Explore this market';
  // (1) These count OPPORTUNITIES CARRYING A SIGNAL, not distinct organizations. VERIFIED
  //     in todays-lens.ts:82 — `.from('sam_opportunities').select('notice_id', {count:'exact'})`.
  //     "1,037 repeat buyers" therefore claimed 1,037 buying ORGS and was false. Eric caught
  //     it 2026-08-19. Never restore a phrasing that implies a count of buyers.
  // (2) Renamed from "This market today" — these are CURRENT-MARKET totals, not today's
  //     changes, and the section now leads with the honest total it describes.
  // (4) Deliberately QUIET (13px, muted) so the 17 NEW matches stay dominant: the email
  //     answers "what happened since yesterday?", not "describe my whole market".
  return `
  <p style="color:#0f172a;font-size:11px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;margin:30px 0 0 0;">Your market at a glance</p>
  <div style="height:1px;background:#e5e7eb;margin:10px 0 14px 0;"></div>
  <p style="color:#475569;font-size:14px;font-weight:700;line-height:1.45;margin:0;">${totalLabel} active opportunities</p>
  ${restLine}
  ${lensLine}
  <p style="margin:13px 0 0 0;">
    <a href="${mapUrl}" style="color:#4f46e5;font-size:13px;font-weight:700;text-decoration:none;">${ctaLabel} &rarr;</a>
  </p>`;
}
