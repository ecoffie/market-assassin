/**
 * Signed preferences: unsubscribe → save targeting → reload stays paused.
 * Dedicated throwaway account only. Never Adam's Gmail.
 *
 *   npx tsx --env-file=/tmp/ma-prod.clean.env scripts/browser-unsub-persist.ts
 */
import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const EMAIL = 'mindy.unsub.persist.20260913@example.test';
const HOST = 'https://getmindy.ai';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.EMAIL_ACTION_SECRET || process.env.ADMIN_PASSWORD;
if (!url || !key || !secret) {
  console.error('missing supabase or EMAIL_ACTION_SECRET/ADMIN_PASSWORD');
  process.exit(2);
}
const signingSecret: string = secret;
const sb = createClient(url, key, { auth: { persistSession: false } });

function sign(email: string) {
  const ts = Math.floor(Date.now() / 1000);
  const token = createHmac('sha256', signingSecret)
    .update(`${email.toLowerCase()}:${ts}`)
    .digest('hex')
    .substring(0, 32);
  return { token, ts };
}

async function cleanup() {
  const { error } = await sb.from('user_notification_settings').delete().eq('user_email', EMAIL);
  if (error) console.error('cleanup failed:', error.message);
}

async function readRow() {
  const { data, error } = await sb
    .from('user_notification_settings')
    .select('alerts_enabled, alert_frequency, keywords, naics_codes')
    .eq('user_email', EMAIL)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function main() {
  await cleanup();
  const now = new Date().toISOString();
  const { error: insErr } = await sb.from('user_notification_settings').insert({
    user_email: EMAIL,
    alerts_enabled: true,
    alert_frequency: 'daily',
    briefings_enabled: true,
    is_active: true,
    naics_codes: ['541512'],
    keywords: ['identity management'],
    created_at: now,
    updated_at: now,
  });
  if (insErr) throw insErr;

  const unsub = await fetch(`${HOST}/api/alerts/unsubscribe?email=${encodeURIComponent(EMAIL)}`);
  if (!unsub.ok) throw new Error(`unsubscribe HTTP ${unsub.status}`);
  const afterUnsub = await readRow();
  if (afterUnsub?.alert_frequency !== 'paused' || afterUnsub.alerts_enabled !== false) {
    throw new Error(`unsubscribe did not pause: ${JSON.stringify(afterUnsub)}`);
  }

  const { token, ts } = sign(EMAIL);
  const prefsUrl = `${HOST}/alerts/preferences?email=${encodeURIComponent(EMAIL)}&token=${token}&ts=${ts}`;

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(prefsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#keywords', { timeout: 30000 });
    const statusBefore = await page.$eval('aside', (el) => el.textContent || '');
    if (!/Paused/.test(statusBefore)) {
      throw new Error(`UI did not show Paused after unsubscribe. Sidebar: ${statusBefore.slice(0, 300)}`);
    }
    await page.click('#keywords', { clickCount: 3 });
    await page.type('#keywords', 'identity management, PAM');
    await Promise.all([
      page.waitForFunction(() => document.body.innerText.includes('saved') || document.body.innerText.includes('Done'), { timeout: 20000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#keywords', { timeout: 30000 });
    const statusAfter = await page.$eval('aside', (el) => el.textContent || '');
    const frequencyValue = await page.$eval('#frequency', (el) => (el as HTMLSelectElement).value).catch(() => 'hidden-in-quick-setup');
    const afterSave = await readRow();
    const result = {
      statusAfterContainsPaused: /Paused/.test(statusAfter),
      frequencyValue,
      db: afterSave,
    };
    if (!result.statusAfterContainsPaused || afterSave?.alert_frequency !== 'paused' || afterSave.alerts_enabled !== false) {
      throw new Error(`save/reload unmuted: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await browser.close();
    await cleanup();
  }
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});
