/**
 * Debug auth-link generation for a given user email.
 *
 * Generalized from the original Sue Westover debug session. Use this when
 * a customer reports a broken setup / reset flow and you want to see what
 * Supabase Admin actually returns: link types, redirect targets, the
 * user's identity providers, and whether `generateSetupLink` falls back
 * to recovery vs invite.
 *
 * Usage:
 *   npx tsx scripts/debug-auth-link.ts <email>
 *
 * Example:
 *   npx tsx scripts/debug-auth-link.ts customer@example.com
 *
 * Reads SUPABASE_URL + SERVICE_ROLE_KEY from .env.local. Read-only on the
 * Supabase side (generateLink is safe — it doesn't email).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { generateSetupLink, getSetupRedirectUrl } from '../src/lib/mindy/account-setup';

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx tsx scripts/debug-auth-link.ts <email>');
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const redirectSetup = getSetupRedirectUrl();
  const redirectReset = 'https://getmindy.ai/app/reset-password';

  console.log(`Debugging auth links for: ${email}\n`);

  for (const type of ['recovery', 'invite'] as const) {
    const r = await sb.auth.admin.generateLink({
      type,
      email,
      options: { redirectTo: type === 'invite' ? redirectSetup : redirectReset },
    });
    console.log(type, {
      error: r.error?.message || null,
      hasLink: Boolean(r.data?.properties?.action_link),
      linkPrefix: r.data?.properties?.action_link?.slice(0, 80),
    });
  }

  // Find the existing Supabase user (if any) and report identity-provider
  // attachment — useful when a customer says "I can't reset my password"
  // and the answer is "you signed up with Google, not email/password".
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const u = list.users.find((x) => x.email?.toLowerCase() === email);
  console.log('user', u ? {
    id: u.id,
    email: u.email,
    identities: u.identities?.map((i) => ({ provider: i.provider, id: i.id })),
    emailConfirmedAt: u.email_confirmed_at,
  } : 'NOT FOUND in auth.users');

  try {
    const setup = await generateSetupLink(email, redirectSetup);
    console.log('generateSetupLink', setup.type, setup.url.slice(0, 80) + '...');
  } catch (e) {
    console.log('generateSetupLink error', e instanceof Error ? e.message : e);
  }
}

main().catch(console.error);
