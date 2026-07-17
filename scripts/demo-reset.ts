/**
 * One command to put a demo account back to a clean first-run state.
 *
 *   npm run demo:reset -- coffiemiami@gmail.com          # dry-run (default-safe)
 *   npm run demo:reset -- coffiemiami@gmail.com --go     # actually do it
 *
 * Why this exists: rehearsing the demo DESTROYS the state under test — every
 * successful practice run needs another reset ("i just did a practice run of
 * coffiemiami@gmail.com and it worked great but now I need you to reset it
 * again"). That loop ran 7 times in 25 days, each one a multi-prompt round trip.
 *
 * Nothing here is new. reset-mindy-user-activity.ts and grant-mindy-pro-once.ts
 * already existed and already worked — they just were never wired into one
 * command, so the loop kept being driven by hand.
 *
 * Order matters: reset CLEARS targeting + onboarding_completed, then the grant
 * re-establishes Pro. Granting first would work too, but resetting second could
 * clobber it — so reset always runs first.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { spawnSync } from 'node:child_process';

const email = (process.argv[2] || '').toLowerCase().trim();
const GO = process.argv.includes('--go');

if (!email || !email.includes('@')) {
  console.error('Usage: npm run demo:reset -- <email> [--go]');
  console.error('       (dry-run unless --go)');
  process.exit(1);
}

function run(label: string, args: string[]): boolean {
  console.log(`\n${'─'.repeat(70)}\n▶ ${label}\n${'─'.repeat(70)}`);
  // No --env-file: both child scripts already call dotenv config({path:'.env.local'})
  // themselves, and passing the flag would hard-error if that file is absent.
  const r = spawnSync('npx', ['tsx', ...args], {
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    // Never continue past a failure and report success -- a half-reset account
    // that looks ready is worse than one that visibly failed.
    console.error(`\n✗ ${label} FAILED (exit ${r.status}). Stopping — the account is in a PARTIAL state.`);
    return false;
  }
  return true;
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://getmindy.ai';

console.log(`\n=== demo:reset — ${email} ===`);
console.log(GO ? 'mode: EXECUTE (writing)' : 'mode: DRY RUN (no writes — pass --go to execute)');

// 1. Wipe activity + clear targeting + onboarding_completed=false.
//    This script is dry-run by default and takes --go, so pass it through.
const resetArgs = ['scripts/reset-mindy-user-activity.ts', email];
if (GO) resetArgs.push('--go');
if (!run('Reset activity + onboarding state', resetArgs)) process.exit(1);

// 2. Re-grant Pro. Only meaningful on a real run; skip during a dry-run so the
//    dry-run stays genuinely side-effect-free.
if (GO) {
  if (!run('Grant Mindy Pro', ['scripts/grant-mindy-pro-once.ts', email])) process.exit(1);
} else {
  console.log(`\n${'─'.repeat(70)}\n▶ Grant Mindy Pro\n${'─'.repeat(70)}`);
  console.log('  (skipped in dry-run — it writes. Pass --go to include it.)');
}

console.log(`\n${'='.repeat(70)}`);
if (GO) {
  console.log(`✓ ${email} is reset and has Pro.\n`);
  console.log('  Open a FRESH INCOGNITO window — a normal window will reuse the cached');
  console.log('  session and you will not see the first-run flow:\n');
  console.log(`    ${appUrl}/app/onboarding\n`);
  console.log('  (Past demos were misread because the reset looked broken when it was');
  console.log("   really just a cached session: \"i've been demo outside of incognito\".)");
} else {
  console.log('Dry run complete. Nothing was written.');
  console.log(`Re-run with --go to execute:\n\n    npm run demo:reset -- ${email} --go`);
}
console.log('='.repeat(70) + '\n');
