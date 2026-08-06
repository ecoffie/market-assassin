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
 * @returns       An email-safe HTML string (a <table> block, inline styles only).
 */
export function renderTodaysLensEmailBlock(lens: TodaysLens, baseUrl: string): string {
  const grounded = lens.grounded && lens.totalOpen > 0 && lens.strands.length > 0;

  if (!grounded) {
    // Quiet day — NO fabricated counts. Honest one-liner + the whole map (no strategy filter).
    const mapUrl = `${baseUrl}/opportunity-map?src=alert`;
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
  const strandRows = lens.strands
    .map(
      (s) => `
        <tr>
          <td style="padding:6px 0;color:#e2e8f0;font-size:14px;">${esc(s.label)}</td>
          <td style="padding:6px 0;color:#ffffff;font-size:15px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;">${s.count}</td>
        </tr>`
    )
    .join('');

  const mapUrl = `${baseUrl}/opportunity-map?strategy=${encodeURIComponent(lens.lensStrategy)}&src=alert`;

  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;border-collapse:separate;">
    <tr>
      <td style="background:#0f172a;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:12px;padding:22px 24px;">
        <p style="color:#a5b4fc;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 14px 0;text-align:center;">Today On Your Map</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin:0 auto;max-width:360px;">
          ${strandRows}
        </table>
        <p style="margin:18px 0 0 0;text-align:center;">
          <a href="${mapUrl}" style="${BUTTON_STYLE}">Open Today's Map &rarr;</a>
        </p>
      </td>
    </tr>
  </table>`;
}
