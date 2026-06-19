#!/usr/bin/env node
/**
 * Test the agency resolver via the production /api/admin/proposal-ab
 * endpoint. Sends a tiny RFP excerpt with the user-supplied agency
 * "U.S. Army Marketing and Advertising Program" and checks that the
 * v2 meta panel reports Army pain points were used.
 *
 * Run AFTER deploy lands.
 */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const URL = `https://getmindy.ai/api/admin/proposal-ab?password=${encodeURIComponent(ADMIN_PASSWORD)}`;

(async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sectionType: 'past_performance',
      email: 'evankoffdev@gmail.com',
      rfpAgency: 'U.S. Army Marketing and Advertising Program',
      sourceText: `SOURCES SOUGHT NOTICE for the U.S. Army Marketing and Advertising Program (MAP).
This is a Sources Sought to identify capable contractors for recruitment marketing and
advertising services supporting Army recruiting goals. Required capabilities: marketing
strategy, creative development, lead generation, broadcast media, digital media.`,
    }),
  });
  const data = await res.json();
  console.log('v2 meta:');
  console.log('  agencyDetected:', data.v2?.meta?.agencyDetected);
  console.log('  painPointsUsed:', data.v2?.meta?.painPointsUsed);
  console.log('  lensId:', data.v2?.meta?.lensId);
  console.log('  humanized:', data.v2?.meta?.humanized);

  if (data.v2?.context?.agency?.painPoints?.length > 0) {
    console.log('\nFirst 3 pain points used:');
    data.v2.context.agency.painPoints.slice(0, 3).forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }
})();
