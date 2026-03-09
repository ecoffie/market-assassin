// Admin endpoint to sync FHC members from Stripe and grant MA Standard + Briefings
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import Stripe from 'stripe';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// FHC product IDs from Stripe
const FHC_PRODUCT_IDS = [
  'prod_TaiXlKb350EIQs', // 39 active, $3,861 MRR
  'prod_TMUmxKTtooTx6C', // 8 active, $762 MRR
];

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripe = getStripe();
  const supabase = getSupabase();

  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Get all active FHC subscriptions from Stripe
  const fhcMembers: { email: string; customerId: string; productId: string; status: string }[] = [];

  for (const productId of FHC_PRODUCT_IDS) {
    // Get all prices for this product
    const prices = await stripe.prices.list({ product: productId, active: true });

    for (const price of prices.data) {
      // Get active subscriptions for this price
      let hasMore = true;
      let startingAfter: string | undefined;

      while (hasMore) {
        const subscriptions = await stripe.subscriptions.list({
          price: price.id,
          status: 'active',
          limit: 100,
          ...(startingAfter && { starting_after: startingAfter }),
        });

        for (const sub of subscriptions.data) {
          // Get customer email
          const customer = await stripe.customers.retrieve(sub.customer as string);
          if (customer.deleted) continue;

          const email = customer.email;
          if (email) {
            fhcMembers.push({
              email: email.toLowerCase(),
              customerId: customer.id,
              productId,
              status: sub.status,
            });
          }
        }

        hasMore = subscriptions.has_more;
        if (subscriptions.data.length > 0) {
          startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
        }
      }
    }
  }

  // Dedupe by email
  const uniqueEmails = [...new Set(fhcMembers.map(m => m.email))];

  // Check which members are missing access
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('email, access_assassin_standard, access_briefings')
    .in('email', uniqueEmails);

  const profileMap = new Map(profiles?.map(p => [p.email.toLowerCase(), p]) || []);

  const missingStandard: string[] = [];
  const missingBriefings: string[] = [];
  const missingProfile: string[] = [];

  for (const email of uniqueEmails) {
    const profile = profileMap.get(email);
    if (!profile) {
      missingProfile.push(email);
      missingStandard.push(email);
      missingBriefings.push(email);
    } else {
      if (!profile.access_assassin_standard) {
        missingStandard.push(email);
      }
      if (!profile.access_briefings) {
        missingBriefings.push(email);
      }
    }
  }

  return NextResponse.json({
    totalFHCMembers: uniqueEmails.length,
    fhcEmails: uniqueEmails,
    issues: {
      missingProfile: { count: missingProfile.length, emails: missingProfile },
      missingStandard: { count: missingStandard.length, emails: missingStandard },
      missingBriefings: { count: missingBriefings.length, emails: missingBriefings },
    },
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stripe = getStripe();
  const supabase = getSupabase();

  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Get all active FHC subscriptions from Stripe
  const fhcMembers: { email: string; customerId: string }[] = [];

  for (const productId of FHC_PRODUCT_IDS) {
    const prices = await stripe.prices.list({ product: productId, active: true });

    for (const price of prices.data) {
      let hasMore = true;
      let startingAfter: string | undefined;

      while (hasMore) {
        const subscriptions = await stripe.subscriptions.list({
          price: price.id,
          status: 'active',
          limit: 100,
          ...(startingAfter && { starting_after: startingAfter }),
        });

        for (const sub of subscriptions.data) {
          const customer = await stripe.customers.retrieve(sub.customer as string);
          if (customer.deleted) continue;

          const email = customer.email;
          if (email) {
            fhcMembers.push({
              email: email.toLowerCase(),
              customerId: customer.id,
            });
          }
        }

        hasMore = subscriptions.has_more;
        if (subscriptions.data.length > 0) {
          startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
        }
      }
    }
  }

  // Dedupe by email
  const uniqueMembers = Array.from(
    new Map(fhcMembers.map(m => [m.email, m])).values()
  );

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      message: `Would sync ${uniqueMembers.length} FHC members`,
      members: uniqueMembers.map(m => m.email),
      instructions: 'Add ?mode=execute to actually sync access',
    });
  }

  // Execute - grant access to all FHC members
  const results = {
    created: [] as string[],
    updated: [] as string[],
    failed: [] as { email: string; error: string }[],
  };

  for (const member of uniqueMembers) {
    try {
      // Check if profile exists
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('id, access_assassin_standard, access_briefings')
        .eq('email', member.email)
        .single();

      if (existing) {
        // Update if missing access
        if (!existing.access_assassin_standard || !existing.access_briefings) {
          const { error: updateError } = await supabase
            .from('user_profiles')
            .update({
              access_assassin_standard: true,
              access_briefings: true,
              stripe_customer_id: member.customerId,
            })
            .eq('id', existing.id);

          if (updateError) {
            results.failed.push({ email: member.email, error: updateError.message });
            continue;
          }
          results.updated.push(member.email);
        }
      } else {
        // Create new profile
        const { error: insertError } = await supabase
          .from('user_profiles')
          .insert({
            email: member.email,
            stripe_customer_id: member.customerId,
            access_assassin_standard: true,
            access_briefings: true,
            access_hunter_pro: false,
            access_content_standard: false,
            access_content_full_fix: false,
            access_assassin_premium: false,
            access_recompete: false,
            access_contractor_db: false,
          });

        if (insertError) {
          results.failed.push({ email: member.email, error: insertError.message });
          continue;
        }
        results.created.push(member.email);
      }

      // Set KV access for both MA and Briefings
      try {
        await kv.set(`ma:${member.email}`, 'true');
        await kv.set(`briefings:${member.email}`, 'true');
      } catch (kvError) {
        console.warn(`KV error for ${member.email}:`, kvError);
      }
    } catch (err) {
      results.failed.push({
        email: member.email,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    mode: 'execute',
    message: `Synced ${results.created.length + results.updated.length} FHC members`,
    created: results.created,
    updated: results.updated,
    failed: results.failed,
    total: uniqueMembers.length,
  });
}
