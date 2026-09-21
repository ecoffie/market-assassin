/**
 * Free→paid upgrade drip — 4 value-first emails on days 1 / 3 / 7 / 14 after a
 * free user signs up. Voice follows the GovCon Giants nurture playbook
 * (~/Bootcamp/EMAIL-SEQUENCE-10-DAY-NURTURE.md, memory marketing-email-voice):
 *
 *   - Subject = curiosity/value, NEVER "feature X is live".
 *   - Body = ONE GovCon lesson + real numbers as proof + concrete homework.
 *   - Eric's warm first-person voice, signed Eric.
 *   - Mindy Pro is the QUIET enabler in the P.S. — the payoff to the insight,
 *     not the headline.
 *   - P.S. teases the next email's value.
 *
 * All facts are REAL (88K SAM opps, the 72%-hidden coverage lesson, 7,800
 * forecasts, expiring-contract recompetes) — no invented numbers.
 */

export interface DripEmail {
  day: number;
  emailType: string; // unique → dedup in email_provider_sends (fires once/user)
  subject: string;
  html: (firstName: string, ctaUrl: string) => string;
}

const SIGN = `Eric Coffie<br/>GovCon Giants`;

function wrap(bodyHtml: string): string {
  // Plain, letter-style email (matches the nurture playbook — not a product
  // brochure). Mindy navy→purple only on the single soft CTA button.
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;font-size:16px;line-height:1.6;">
${bodyHtml}
</div>`;
}

function softCta(url: string, label: string): string {
  return `<p style="margin:22px 0;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;">${label}</a></p>`;
}

export const UPGRADE_DRIP: DripEmail[] = [
  {
    day: 1,
    emailType: 'upgrade_drip_d1',
    subject: 'The $243M mistake almost every contractor makes',
    html: (first, cta) => wrap(`
<p>Hey ${first || 'there'},</p>
<p>Quick lesson that'll change how you search for work.</p>
<p>Say you sell drones. You'd search NAICS <b>336411</b> (Aircraft Manufacturing), right? That's the "obvious" code.</p>
<p>Here's the problem: drones are bought across <b>42 different NAICS codes</b> — a $243M/year market. That one obvious code? It's only <b>28%</b> of it. Search just that and you <b>miss 72% of the money</b>.</p>
<p>This is why most contractors feel like "there's nothing out there for me." They're looking through a keyhole.</p>
<p><b>Your homework:</b> think about the ONE NAICS code you search most. Now ask — what else gets bought under different codes that you'd actually qualify for? That list is usually 3–5x bigger than people think.</p>
<p>Talk soon,</p>
<p>${SIGN}</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. Doing this coverage math by hand across 42 codes takes hours. Inside Mindy Pro you type "drones" and it maps the whole market for you in seconds. ${softCta(cta, 'See how Mindy maps your market →')} Tomorrow: the $430 billion most people never look at.</p>
`),
  },
  {
    day: 3,
    emailType: 'upgrade_drip_d3',
    subject: '$430 billion is expiring — and nobody told the incumbents',
    html: (first, cta) => wrap(`
<p>Hey ${first || 'there'},</p>
<p>Every federal contract ends. When it does, the agency has to re-compete the work — and that's the single best opening for a small business.</p>
<p>Why? The incumbent gets comfortable. Pricing drifts. And agencies are <i>required</i> to look at new competition.</p>
<p>The catch: the window opens <b>6 to 18 months before</b> the contract expires. If you wait until you see the RFP on SAM.gov, you're already too late — the incumbent has been positioning for a year.</p>
<p><b>Your homework:</b> pick one agency you'd love to work with. Find a contract in your space that's expiring in the next 12 months. That's your target — start building the relationship now, not when the solicitation drops.</p>
<p>Talk soon,</p>
<p>${SIGN}</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. Finding expiring contracts by hand means digging through USASpending one award at a time. Mindy Pro surfaces the recompetes in your space automatically and alerts you when one moves. ${softCta(cta, 'See your expiring-contract targets →')} Next: why the title of an opportunity lies to you.</p>
`),
  },
  {
    day: 7,
    emailType: 'upgrade_drip_d7',
    subject: 'The opportunity title is lying to you',
    html: (first, cta) => wrap(`
<p>Hey ${first || 'there'},</p>
<p>Here's something that costs contractors real money: <b>the title of a solicitation often has nothing to do with what's actually being bought.</b></p>
<p>A contracting officer types a vague title — "Professional Support Services" — but the real scope is buried in the attachment. If you only search titles (like most alert tools do), you never see it.</p>
<p>We found this the hard way: across the SAM.gov cache, the keyword you're looking for is frequently in the <b>body</b>, not the title. Title-only search misses it completely.</p>
<p><b>Your homework:</b> next time you find an opportunity that fits, open the actual SOW/PWS attachment before you judge it. You'll be surprised how often the title undersold it — and how often a boring title hides perfect work.</p>
<p>Talk soon,</p>
<p>${SIGN}</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. Reading every attachment by hand isn't realistic at scale. Mindy Pro searches the full body + the SOW/PWS text of 88,000+ opportunities, so the right ones surface even when the title hides them. ${softCta(cta, 'Search the full text in Mindy →')} Last one: how the winners decide what NOT to bid.</p>
`),
  },
  {
    day: 14,
    emailType: 'upgrade_drip_d14',
    subject: 'The skill that separates winners: saying no',
    html: (first, cta) => wrap(`
<p>Hey ${first || 'there'},</p>
<p>Two weeks in — here's the most valuable thing I can teach you about federal contracting.</p>
<p><b>Winning is mostly about what you DON'T bid on.</b></p>
<p>The contractors who win consistently aren't chasing everything. They pick 2–3 opportunities where they have a real edge — the right past performance, a relationship with the office, pricing they can defend — and they go all-in. Everyone else spreads thin across 20 long-shots and wins none.</p>
<p>The hard part is the discipline to walk away from work that "kind of" fits. That decision — bid or no-bid — is where most of the leverage is.</p>
<p><b>Your homework:</b> look at the last 5 opportunities you considered. Honestly, how many did you have a real edge on? If it's all 5, you're not being selective enough. If it's 1, that's the one — go deep.</p>
<p>You've got this.</p>
<p>${SIGN}</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. Mindy Pro does the bid/no-bid grounding for you — incumbent, competition, fit, and why — so you spend your hours on the 2–3 that count, not all 20. That's the whole point. ${softCta(cta, 'Let Mindy help you focus →')} Thanks for reading these — reply anytime, I read them.</p>
`),
  },
];

/** Pick the drip email whose day exactly matches the user's signup age. */
export function dripForDay(daysSinceSignup: number): DripEmail | null {
  return UPGRADE_DRIP.find((d) => d.day === daysSinceSignup) || null;
}
