/**
 * Targeted profile-completion reminder — an EXPLICIT recipient list, nothing else.
 *
 *   npx tsx scripts/send-profile-reminder-targeted.ts          # DRY RUN (default)
 *   npx tsx scripts/send-profile-reminder-targeted.ts --go     # actually send
 *
 * WHY THIS EXISTS instead of /api/admin/send-profile-reminders:
 * That route walks a CURSOR through a 4,932-person queue in batches of 50. Its
 * "empty profile" test is `hasCustomProfile` — anyone still on the 5-code default
 * seed counts, which is 5,082 users. Running it in execute mode would have emailed
 * 50 people off the top of that queue, NONE of them necessarily the cohort we
 * identified. Verified 2026-08-03: a preview returned jepps@babson.edu,
 * jwebster@clarknexsen.com — strangers to this investigation.
 *
 * This cohort is much narrower and was found by hand:
 *   alerts_enabled AND is_active AND naics_codes IS NULL AND created_at <> '2026-03-27'
 * i.e. people who signed up ORGANICALLY (not the Mar-27 bulk enrollment), have
 * literally ZERO industry codes, and therefore stopped matching anything when the
 * 2026-07-27 NAICS remediation retired the default fallback they were riding on.
 *
 * The list is a FROZEN FILE, not a live query, on purpose. A filter can silently
 * widen when the data shifts under it; a named list cannot. That is exactly how the
 * cron route would have mailed 50 strangers. Re-derive deliberately if run again.
 *
 * Reuses the route's own machinery so nothing diverges: the same
 * createSecureAccessUrl magic link, the same sendEmail transport, the same
 * emailType/tags, and the same KV cooldown key so a recipient can't be double-hit
 * by the cron afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
config({ path: '.env.local' });

const GO = process.argv.includes('--go');
const REMINDER_COOLDOWN_DAYS = 14;

/**
 * Recipients come from a GITIGNORED file, not this source. Customer email addresses
 * do not belong in git history — the list is data, the script is code.
 *
 *   scripts/recipients/<campaign>.txt   — one address per line, # comments allowed
 *
 * Pass --list=<name> to pick a file (default: profile-naics-gap-aug2026).
 * The file's own header records the query the cohort came from, so the derivation
 * stays auditable without shipping the PII.
 */
const listName = (process.argv.find((a) => a.startsWith('--list='))?.split('=')[1]
  || 'profile-naics-gap-aug2026').replace(/[^a-zA-Z0-9._-]/g, '');
const listPath = path.join(__dirname, 'recipients', `${listName}.txt`);

if (!fs.existsSync(listPath)) {
  console.error(`\n✗ Recipient list not found: ${listPath}`);
  console.error(`  It is gitignored by design — recreate it with one email per line.\n`);
  process.exit(1);
}

const RECIPIENTS = fs.readFileSync(listPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

if (RECIPIENTS.length === 0) {
  console.error(`\n✗ ${listPath} contains no addresses.\n`);
  process.exit(1);
}

function emailHtml(setupUrl: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td style="font-size:16px;line-height:1.6;color:#1f2937;">
          <p style="margin:0 0 16px;">Hey,</p>
          <p style="margin:0 0 16px;">Your daily opportunity alerts went quiet on July 27. That was on our end, not yours.</p>
          <p style="margin:0 0 16px;">We fixed a matching problem that had been sending people opportunities nowhere near their industry. Accounts without industry codes set were riding on a default we retired &mdash; so instead of the wrong opportunities, you started getting none.</p>
          <p style="margin:0 0 24px;">Takes about a minute to fix. Add your NAICS codes and alerts start again the next morning &mdash; this time actually matched to what you do.</p>
          <p style="margin:0 0 28px;" align="center">
            <a href="${setupUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:8px;">Set your industry codes</a>
          </p>
          <p style="margin:0 0 16px;">If it's easier, just reply and tell me what your business does &mdash; I'll set it up for you.</p>
          <p style="margin:0;">Talk soon,<br>Eric</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function main() {
  const { createSecureAccessUrl } = await import('../src/lib/access-links');
  const { sendEmail } = await import('../src/lib/send-email');
  const { kv } = await import('@vercel/kv');

  console.log(`\nTargeted profile reminder — ${GO ? 'SEND' : 'DRY RUN'}`);
  console.log(`${RECIPIENTS.length} recipients from ${listName}.txt (explicit list, not a query)\n`);

  if (!GO) {
    RECIPIENTS.forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. ${e}`));
    console.log(`\nDry run — nothing sent. Re-run with --go to send.\n`);
    return;
  }

  let sent = 0;
  const failed: { email: string; error: string }[] = [];

  for (let i = 0; i < RECIPIENTS.length; i++) {
    const email = RECIPIENTS[i];
    try {
      const accessUrl = await createSecureAccessUrl(email, 'briefings');
      await sendEmail({
        to: email,
        subject: 'Your Mindy alerts stopped — quick fix',
        html: emailHtml(`${accessUrl}&setup=true`),
        emailType: 'profile_reminder',
        tags: { campaign: 'profile_naics_gap_aug2026' },
      });
      // Same cooldown key the cron route uses, so this cohort cannot be
      // double-emailed by the bulk job for the next 14 days.
      await kv.set(`admin:profile-reminder:last-sent:${email.toLowerCase().trim()}`,
        new Date().toISOString(), { ex: REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 });
      sent++;
      console.log(`  ✓ ${email}`);
      if ((i + 1) % 10 === 0) await new Promise(r => setTimeout(r, 2000)); // rate limit
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ email, error: msg });
      console.error(`  ✗ ${email} — ${msg}`);
    }
  }

  console.log(`\nSent ${sent}/${RECIPIENTS.length}${failed.length ? `, ${failed.length} failed` : ''}\n`);
  if (failed.length) failed.forEach(f => console.error(`  ${f.email}: ${f.error}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
