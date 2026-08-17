// Mirrors the route's noBusinessDayInWindow logic exactly.
function noBusinessDayInWindow(daysBack, nowMs) {
  if (daysBack == null || daysBack <= 0) return false;
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(nowMs - i * 86400000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) return false;
  }
  return true;
}
const SUN = Date.parse('2026-08-02T10:00:00Z'); // Sunday
const MON = Date.parse('2026-08-03T10:00:00Z'); // Monday
const WED = Date.parse('2026-07-29T10:00:00Z'); // Wednesday
const SAT = Date.parse('2026-08-01T10:00:00Z'); // Saturday

const cases = [
  ['Sunday  daysBack=2 (Sat+Sun)   -> suppress', noBusinessDayInWindow(2, SUN), true],
  ['Sunday  daysBack=3 (Fri..Sun)  -> ALARM',    noBusinessDayInWindow(3, SUN), false],
  ['Monday  daysBack=2 (Sun+Mon)   -> ALARM',    noBusinessDayInWindow(2, MON), false],
  ['Saturday daysBack=1 (Sat)      -> suppress', noBusinessDayInWindow(1, SAT), true],
  ['Wednesday daysBack=2           -> ALARM',    noBusinessDayInWindow(2, WED), false],
  ['daysBack=null (all files)      -> ALARM',    noBusinessDayInWindow(null, SUN), false],
  ['daysBack=30                    -> ALARM',    noBusinessDayInWindow(30, SUN), false],
];
let bad = 0;
for (const [name, got, want] of cases) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, want ${want})`);
}

// --- Combined starved/no-data decision -------------------------------------
// The window predicate alone is not the alarm. What pages the operator is
// `starved`, so test the two thresholds TOGETHER. They must match (both <= 1):
// a `noDataWindow` test of `=== 0` let a lone stray record on a weekend window
// fall through to starved — the 2026-08-09 / 2026-08-16 Sunday false alarms.
function decide(fetched, daysBack, nowMs) {
  const noData = fetched <= 1 && noBusinessDayInWindow(daysBack, nowMs);
  return { noDataWindow: noData, starved: fetched <= 1 && !noData };
}

const SUN_AUG16 = Date.parse('2026-08-16T08:00:00Z'); // Sunday
const SUN_AUG09 = Date.parse('2026-08-09T08:00:00Z'); // Sunday
const SAT_AUG08 = Date.parse('2026-08-08T08:00:00Z'); // Saturday (window incl. Fri)
const FRI_AUG07 = Date.parse('2026-08-07T08:00:00Z'); // Friday
const THU_AUG06 = Date.parse('2026-08-06T08:00:00Z'); // Thursday

// Replays the five real "STARVED: fetched 1" runs, cron args daysBack=2.
const decisions = [
  ['REAL Aug16 Sun fetched=1 -> silent', decide(1, 2, SUN_AUG16).starved, false],
  ['REAL Aug09 Sun fetched=1 -> silent', decide(1, 2, SUN_AUG09).starved, false],
  ['REAL Aug08 Sat fetched=1 (Fri in window) -> ALARM', decide(1, 2, SAT_AUG08).starved, true],
  ['REAL Aug07 Fri fetched=1 -> ALARM', decide(1, 2, FRI_AUG07).starved, true],
  ['REAL Aug06 Thu fetched=1 -> ALARM', decide(1, 2, THU_AUG06).starved, true],
  // Guards on the threshold change itself.
  ['Sunday fetched=0 -> silent', decide(0, 2, SUN_AUG16).starved, false],
  ['Sunday fetched=2 -> healthy, not starved', decide(2, 2, SUN_AUG16).starved, false],
  ['Sunday fetched=2 -> not a no-data window', decide(2, 2, SUN_AUG16).noDataWindow, false],
  ['Weekday fetched=0 -> ALARM (cap/WAF)', decide(0, 2, THU_AUG06).starved, true],
  ['Sunday daysBack=null fetched=1 -> ALARM', decide(1, null, SUN_AUG16).starved, true],
];
for (const [name, got, want] of decisions) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got}, want ${want})`);
}

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
