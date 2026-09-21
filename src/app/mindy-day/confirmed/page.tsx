import type { Metadata } from 'next';
import { MINDY_DAY } from '@/lib/mindy/mindy-day';

/**
 * Mindy Day confirmation — the page a registrant lands on right after signing up.
 *
 * WHY THIS LIVES HERE NOW (Eric, 2026-08-20: "it should be a getmindy.ai page anyways"):
 * it used to be static HTML in ~/Bootcamp/funnels/mindy-launch/4-thank-you.html, served
 * through a THREE-hop chain — govcongiants.com rewrites /mindy-launch/* to
 * funnels-one.vercel.app, which is the Vercel project "funnels" building from the
 * Bootcamp repo with root=funnels/. Nothing about that chain is discoverable from the
 * page, and because static HTML cannot import MINDY_DAY, every value on it was a
 * hand-copied mirror of this config.
 *
 * It drifted four separate times: a June Zoom room (in SIX places, one buried in the
 * Add-to-Calendar JS), a stale July date, a missing capacity notice, and an .ics
 * filename that still said "july-25". Each was found and fixed one at a time, and a
 * deploy aimed at the wrong project silently published none of them.
 *
 * Here every displayed value comes from MINDY_DAY, so that whole class of drift is
 * structurally impossible — change the config, every surface follows.
 */

const TITLE = `You're in — ${MINDY_DAY.shortDate} | Mindy Day`;

export const metadata: Metadata = {
  title: TITLE,
  description: `You're registered for Mindy Day, ${MINDY_DAY.dateLabel}, ${MINDY_DAY.timeLabel}. Your Zoom link and calendar invite are here.`,
  // A confirmation page has no business in search results.
  robots: { index: false, follow: false },
};

const AGENDA = [
  'Find your full market from one keyword — the hidden 72%',
  'See who holds any contract now — and when it expires',
  'Watch Mindy read a solicitation and draft the response',
  'Pull the real contacts for a buying office',
  'Every number, traced to a real government source',
];

const NEXT_STEPS = [
  'Check your email for confirmation (check spam!)',
  'Try Mindy now at getmindy.ai so you come with questions',
  'Watch for the 5-part build-up series on our YouTube',
  "The day before, we'll email your live access link",
];

export default function MindyDayConfirmedPage() {
  const { joinUrl, meetingId, passcode, dateLabel, timeLabel, shortDate, zoomCapacity, livestreamUrl } = MINDY_DAY;

  const calendarDetails =
    `Free live working session: build your own federal market map with Mindy on real government data.\n\n` +
    `Join Zoom: ${joinUrl}\nMeeting ID: ${meetingId} · Passcode: ${passcode}\n\n` +
    `Zoom seats ${zoomCapacity} — please join a few minutes early.` +
    (livestreamUrl ? `\nIf the room is full: ${livestreamUrl}` : '');

  const gcalUrl =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent('Mindy Day — GovCon Giants') +
    '&dates=' + MINDY_DAY.calendarDates +
    '&details=' + encodeURIComponent(calendarDetails) +
    '&location=' + encodeURIComponent(joinUrl);

  const facts = [
    { icon: '📅', label: 'Date', value: dateLabel },
    { icon: '🕘', label: 'Time', value: timeLabel },
    { icon: '💻', label: 'Where', value: 'Live on Zoom — your link is right below' },
  ];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-16 text-center">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-500/40 bg-emerald-500/10 text-4xl">
            ✓
          </div>
          <h1 className="mb-3 text-4xl font-bold text-white sm:text-5xl">You&rsquo;re in.</h1>
          <p className="text-lg text-slate-400">
            Your seat for Mindy Day is saved. Everything you need is on this page.
          </p>
        </div>

        <div className="mx-auto mb-12 max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <div className="space-y-5">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-violet-700/50 bg-violet-900/50 text-violet-400">
                  {f.icon}
                </div>
                <div className="text-left">
                  <p className="text-sm text-slate-500">{f.label}</p>
                  <p className="font-semibold text-white">{f.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Zoom details shown in full so a last-minute registrant can join instantly. */}
        <div className="mx-auto mb-12 max-w-md rounded-2xl border-2 border-violet-600 bg-violet-900/20 p-8">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest text-violet-300">Your Zoom Link</p>
          <a
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-8 py-4 text-lg font-bold text-white transition hover:bg-violet-500"
          >
            Join on Zoom
          </a>
          <p className="mt-5 text-sm text-slate-400">
            Meeting ID: <span className="font-semibold text-white">{meetingId}</span>
            &nbsp;·&nbsp; Passcode: <span className="font-semibold text-white">{passcode}</span>
          </p>

          {/*
            CAPACITY: 825 registered against a 500-seat Zoom, so ~325 people cannot get
            into the room. The overflow link renders ONLY when a livestream URL exists —
            an absent URL degrades to "we'll email it", never to a fabricated link.
          */}
          <p className="mx-auto mt-4 max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm leading-relaxed text-amber-200">
            <span className="font-semibold text-amber-100">
              Zoom seats {zoomCapacity.toLocaleString('en-US')} — please join a few minutes early.
            </span>{' '}
            {livestreamUrl ? (
              <>
                If the room is full,{' '}
                <a
                  href={livestreamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-amber-100 underline decoration-amber-400/60 hover:text-white"
                >
                  watch the livestream on YouTube
                </a>
                .
              </>
            ) : (
              <>If the room is full, watch for the livestream link we&rsquo;ll email on the day.</>
            )}
          </p>

          <p className="mt-3 break-all text-xs text-slate-500">
            <a href={joinUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
              {joinUrl}
            </a>
          </p>
          <p className="mt-5 text-sm text-slate-400">
            We&rsquo;ve also emailed this to you — save it for {shortDate}.
          </p>
        </div>

        <div className="mx-auto mb-12 max-w-md">
          <p className="mb-3 text-sm text-slate-500">📌 Add it to your calendar so you don&rsquo;t miss it:</p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href={gcalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              <span>📅</span> Google Calendar
            </a>
            {/* The .ics filename is derived, never hand-typed — the old page shipped
                "mindy-launch-july-25.ics" for an August event. */}
            <a
              href={`/api/mindy-day/calendar.ics`}
              download={`mindy-day-${MINDY_DAY.iso}.ics`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              <span>🍎</span> Apple / Outlook
            </a>
          </div>
        </div>

        <div className="mx-auto mb-12 max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <h2 className="mb-6 text-xl font-bold text-white">What You&rsquo;ll See Live</h2>
          <div className="space-y-3 text-left">
            {AGENDA.map((item, i) => (
              <div key={item} className="flex items-center gap-3 text-slate-400">
                <span className="font-bold text-violet-400">{i + 1}.</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto mb-12 max-w-lg rounded-2xl border border-violet-700/50 bg-violet-900/20 p-8">
          <h2 className="mb-4 text-xl font-bold text-white">What Happens Next</h2>
          <ul className="space-y-2 text-left text-slate-400">
            {NEXT_STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-2">
                <span className="font-bold text-violet-400">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mb-4 text-xl italic text-slate-400">
          &ldquo;The big contractors have armies. Now you have Mindy.&rdquo;
        </p>
        <p className="font-medium text-violet-400">See you {shortDate}!</p>

        <div className="mt-12">
          <p className="mb-4 text-sm text-slate-500">Follow us for more GovCon tips:</p>
          <div className="flex justify-center gap-4">
            <a href="https://youtube.com/@govcongiants" target="_blank" rel="noopener noreferrer" className="text-slate-500 transition hover:text-white">YouTube</a>
            <a href="https://linkedin.com/company/govcongiants" target="_blank" rel="noopener noreferrer" className="text-slate-500 transition hover:text-white">LinkedIn</a>
            <a href="https://instagram.com/getmindyai" target="_blank" rel="noopener noreferrer" className="text-slate-500 transition hover:text-white">Instagram</a>
          </div>
        </div>
      </div>
    </main>
  );
}
