/**
 * Builds public/templates/event-action-plan-template.docx — the free "Event Action Plan" template
 * offered at getmindy.ai/event-action-plan.
 *
 * Generic on purpose: the structure comes from a real industry-day plan, but every company fact,
 * buyer, date and price is a [bracketed placeholder]. Never put a real customer's details here.
 *
 *   node scripts/build-event-action-plan-template.mjs
 */
import { writeFileSync } from 'node:fs';
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

const NAVY = '1B3A6B';
const WASH = 'EFF5FF';
const MUTED = '6B6459';
const FONT = 'Calibri';

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color });
const p = (text, o = {}) => new Paragraph({ spacing: { after: o.after ?? 80 }, children: Array.isArray(text) ? text : [run(text, o)] });
const h = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 100 },
  shading: { type: ShadingType.CLEAR, fill: WASH, color: 'auto' },
  children: [run(text.toUpperCase(), { bold: true, size: 22, color: NAVY })],
});
const tip = (text) => p([run('Tip: ', { bold: true, color: NAVY, size: 18 }), run(text, { italics: true, color: MUTED, size: 18 })]);
const bullet = (text) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [run(text)] });
const check = (text) => p([run('☐  ', { size: 22 }), run(text)]);

const border = { style: BorderStyle.SINGLE, size: 4, color: 'DCD8CF' };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
function table(headers, rows, widths) {
  const cell = (text, isHead, w) => new TableCell({
    width: { size: Math.round((10440 * w) / 100), type: WidthType.DXA },
    shading: isHead ? { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(text).split('\n').map((line, i) => p(line, { bold: isHead || (i === 0 && !isHead && w <= 22), color: isHead ? 'FFFFFF' : undefined, after: 40, size: 18 })),
  });
  const total = 10440; // letter width minus 0.625in margins, in twips
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths.map((w) => Math.round((total * w) / 100)),
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((t, i) => cell(t, true, widths[i])) }),
      ...rows.map((r) => new TableRow({ children: r.map((t, i) => cell(t, false, widths[i])) })),
    ],
  });
}

const agendaRow = (time, priority, what) => [time, priority, what];

const children = [
  p([run('[EVENT NAME] — Action Plan', { bold: true, size: 36, color: NAVY })], { after: 60 }),
  p('[Event full name] · [Venue, City, State] · [Dates] (all times [time zone])', { color: MUTED }),
  p('Prepared for [Your company] ([Attendees]) · Pursuit: [what you sell] — [states / regions]', { color: MUTED, after: 160 }),
  tip('Fill every [bracket]. Delete the tips before you print. One page of focus beats ten pages of agenda.'),

  h('Critical deadlines'),
  table(['#', 'Deadline', 'What to do'], [
    ['1', 'Register by [date]', 'Regular rate ends [date] ([price]); late rate [price]. Refund cutoff: [date]. Account setup needed: [Login.gov / ID.me / other].'],
    ['2', 'Pre-event sessions by [date]', 'Many events require you to attend virtual sessions or complete a matchmaking profile before they give you 1:1 meetings. Where: [portal → menu path].'],
    ['3', 'Certification check now', 'Confirm the certifications you will claim (8(a), HUBZone, WOSB, SDVOSB/VetCert) are APPROVED, not self-identified. If not approved, every conversation is about future work, not current set-aside bids.'],
  ], [6, 24, 70]),

  h('The pitch (30 seconds)'),
  p('“[Company], [city]. [Certification / ownership]. [One or two service lines] across [states]. We [how you deliver the work — self-perform / partners]. Who buys that at your [offices / stations / bases]?”', { italics: true }),
  p('Door in: [the buyer most likely to buy first]. Follow-on: [the bigger buyer you grow into].'),
  tip('End the pitch with a question so the buyer starts talking.'),

  h('What you sell and who buys it'),
  table(['Service line', 'Specs', 'Federal buyers at this event'], [
    ['[Service line 1]', 'NAICS [code] · PSC [code]\n[What the work includes]\nOn your SAM record? [yes / no — add it]', '[Agency / office 1] · [Agency / office 2]'],
    ['[Service line 2]', 'NAICS [code] · PSC [code]\n[What the work includes]\nOn your SAM record? [yes / no — add it]', '[Agency / office 1] · [Agency / office 2]'],
  ], [22, 39, 39]),
  p([run('What the data shows: ', { bold: true }), run('[Upcoming forecasts, open bids and expiring contracts for your codes and these buyers, with values and dates. Mindy pulls this in minutes at getmindy.ai.]')]),
  p([run('If asked “have you done this for the government?”: ', { bold: true }), run('“[An honest answer. Never claim past performance you don’t have.]”')]),
  p([run('Card facts: ', { bold: true }), run('UEI [ ] · CAGE [ ] · [Certifications] · NAICS [ ] · [City, State] · SAM active through [date].')]),

  h('Before you arrive'),
  table(['When', 'Priority', 'What to do'], [
    agendaRow('By [date]', 'PRIORITY 1', 'Register. [Portal]. Register every attendee. The owner should attend.'),
    agendaRow('Now – [date]', 'PRIORITY 1', 'Pre-event / matchmaking sessions. Sign up for every match that fits: [buyers]. These unlock the in-person roundtables and 1:1s.'),
    agendaRow('After each session', 'PRIORITY 2', 'Book roundtables and 1:1s. Order: [best buyer first], then [next], then prime contractors. Fill every 1:1 slot you can.'),
  ], [18, 16, 66]),

  h('[Day 0 — date]'),
  table(['Time', 'Session · Priority', 'What to do · Questions to ask'], [
    agendaRow('[time]', 'Registration / badge pickup', 'Pick up badges early. Print your 1:1 schedule. Check business cards and capability statements.'),
    agendaRow('[time]', 'Welcome reception', 'Scouting, not pitching. Note which buyers and prime contractors are here.'),
  ], [16, 26, 58]),

  h('[Day 1 — date]'),
  table(['Time', 'Session · Priority', 'What to do · Questions to ask'], [
    agendaRow('[time]', 'On-site scheduling desk\nPRIORITY 2', 'Fill empty 1:1 slots. Ask: “We need 1:1s with [buyer] and [buyer]. Who is in the system?”'),
    agendaRow('[time]', 'Opening session\n[Speaker, title]', 'Thirty seconds and a card afterward. No ask. Build recall.'),
    agendaRow('[time]', '[Key leader / roundtable]\nPRIORITY 1', 'Your most important conversation. Why this buyer: [reason]. Leave with: [a name / a date / a next step].\nAsk: “[Question about upcoming work and who runs it]”\nAsk: “[Question about timing or set-aside]”'),
    agendaRow('[time]', '[Office hours / roundtable]\nPRIORITY 3', 'Follow-up questions only. Ask: “[Question]”'),
    agendaRow('[time]', 'Lunch', 'Sit with prime contractors, not other small businesses.'),
    agendaRow('[time]', 'Prime contractor sessions\nPRIORITY 4', 'Subcontracting is the fastest path to a first federal reference.\nAsk: “Which of your contracts in [region] have [your scope] you sub out today?”'),
    agendaRow('[time]', 'Reception', 'Second shot at anyone you missed.'),
  ], [16, 26, 58]),

  h('[Day 2 — date]'),
  table(['Time', 'Session · Priority', 'What to do · Questions to ask'], [
    agendaRow('[time]', '1:1 meetings\nPRIORITY 1', 'The payoff of the week. Order: [buyer] → [buyer] → [buyer]. Open with the pitch, then let them talk. Leave every meeting with a name, an email and a next step.\nAsk: “Based on what you heard, what’s the one contract we should be ready for in the next six months?”'),
    agendaRow('[time]', 'Prime contractor roundtables', 'Exchange capability statements. Do not sign anything on the floor.'),
    agendaRow('[time]', '[Sessions to skip]', 'Skip unless a slot opens: [sessions outside your lane].'),
    agendaRow('[time]', 'Departure', 'Send follow-up emails within 48 hours.'),
  ], [16, 26, 58]),

  h('What NOT to do'),
  bullet('Don’t pitch two businesses at once. Wear one hat.'),
  bullet('Don’t present yourself as a broker. Know the limits on subcontracting for your set-aside and say what you self-perform.'),
  bullet('Don’t claim a certification that isn’t approved. Say “certification in process.”'),
  bullet('Don’t quote prices or schedules. A wrong number follows you.'),
  bullet('Don’t chase leaders outside your lane, however famous.'),
  bullet('Don’t sign teaming agreements on the floor. Exchange capability statements and follow up after.'),

  h('Open items before the event'),
  check('Certification status confirmed (bring the approval letter).'),
  check('Every NAICS code you will pitch is on your SAM record and your matchmaking profile.'),
  check('Registered by [date]; account login set up for every attendee.'),
  check('Pre-event / matchmaking sessions watched for every buyer you want.'),
  check('Capability statement showing only the service lines and states you are pitching.'),
  check('Named partner(s) with a letter of intent for any work you don’t self-perform.'),
  check('Bonding plan if construction work is in scope (surety pre-qualification or SBA Surety Bond Guarantee).'),
  check('Past performance list: commercial, local or principals’ experience you can stand behind.'),
  check('Travel and hotel booked for [dates].'),

  h('After the event'),
  table(['Who you met', 'Agency / company', 'Email', 'Next step', 'Sent?'], [
    ['', '', '', '', '☐'], ['', '', '', '', '☐'], ['', '', '', '', '☐'], ['', '', '', '', '☐'], ['', '', '', '', '☐'],
  ], [22, 22, 22, 26, 8]),

  p('', { after: 200 }),
  p([run('Sources: ', { bold: true, size: 16, color: MUTED }), run('[event agenda, opportunity list, registration page, SAM.gov entity data, Mindy forecast and opportunity data pulled on [date]]. Sessions, speakers and times subject to change.', { size: 16, color: MUTED })]),
];

const doc = new Document({
  creator: 'Mindy',
  title: 'Event Action Plan Template',
  description: 'Free industry day and event action plan template from Mindy (getmindy.ai).',
  sections: [{
    properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            run('Event Action Plan template · Mindy · getmindy.ai/event-action-plan · Page ', { size: 16, color: MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: MUTED }),
          ],
        })],
      }),
    },
    children,
  }],
});

const out = new URL('../public/templates/event-action-plan-template.docx', import.meta.url);
writeFileSync(out, await Packer.toBuffer(doc));
console.log('wrote', out.pathname);
