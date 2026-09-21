/**
 * Experiment Cohort Assignment Script
 *
 * Sets up four cohorts for a 60-90 day A/B/Hold test:
 * 1. experiment_briefings — ~400 free beta users → daily briefings
 * 2. experiment_alerts — ~400 free beta users → daily alerts
 * 3. experiment_hold — ~100 free beta users → current weekly experience
 * 4. paid_existing — all paid customers → daily briefings (separate from A/B)
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/assign-experiment-cohorts.ts   # Preview only
 *   DRY_RUN=false npx tsx scripts/assign-experiment-cohorts.ts  # Execute
 *
 * Environment Variables Required:
 *   - STRIPE_SECRET_KEY
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - RESEND_API_KEY
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import * as fs from 'fs';

// ============================================================
// CONFIGURATION
// ============================================================

const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default to true (safe mode)

const COHORT_RATIOS = {
  briefings: 8,  // ~44.4%
  alerts: 8,     // ~44.4%
  hold: 2,       // ~11.1%
};
const BLOCK_SIZE = COHORT_RATIOS.briefings + COHORT_RATIOS.alerts + COHORT_RATIOS.hold; // 18

const RESEND_AUDIENCE_NAMES = {
  briefings: 'experiment_briefings',
  alerts: 'experiment_alerts',
  hold: 'experiment_hold',
  paid: 'paid_existing',
};

// ============================================================
// TYPES
// ============================================================

interface User {
  user_email: string;
  total_alerts_sent: number;  // Changed from alerts_opened_30d
  set_aside_certifications: string[];
  naics_codes: string[];
  is_active: boolean;
  beta_pioneer: boolean;
  paid_status: boolean;
  experiment_cohort: string | null;
  business_type: string | null;
}

interface PaidCustomer {
  email: string;
  stripeCustomerId?: string;
  productsOwned: string[];
  totalSpent: number;
  source: 'purchases_table' | 'stripe_charges' | 'stripe_subscription';
}

interface CohortAssignment {
  email: string;
  cohort: string;
  reason: string;
  stripeCustomerId?: string;
  productsOwned?: string[];
}

interface CohortStats {
  count: number;
  avgAlertsSent: number;
  certDistribution: Record<string, number>;
  topNaics: Record<string, number>;
}

// ============================================================
// INITIALIZE CLIENTS
// ============================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return new Stripe(key);
}

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('Missing RESEND_API_KEY');
  }
  return new Resend(key);
}

// ============================================================
// STEP 1: PULL PAID CUSTOMERS FROM MULTIPLE SOURCES
// ============================================================

async function fetchPaidCustomers(): Promise<PaidCustomer[]> {
  console.log('\n📦 Step 1: Fetching paid customers...');

  const paidCustomers: Map<string, PaidCustomer> = new Map();
  const supabase = getSupabase();
  const stripe = getStripe();

  // ---- Source 1: purchases table (primary, already synced via webhook) ----
  console.log('   📋 Checking purchases table...');
  const { data: purchases, error: purchaseError } = await supabase
    .from('purchases')
    .select('user_email, product_name, amount_paid, stripe_customer_id')
    .eq('status', 'completed');

  if (purchaseError) {
    console.log(`   ⚠️  Error reading purchases: ${purchaseError.message}`);
  } else if (purchases) {
    console.log(`   Found ${purchases.length} completed purchases in database`);
    for (const p of purchases) {
      const email = p.user_email.toLowerCase();
      const existing = paidCustomers.get(email);
      if (existing) {
        existing.totalSpent += (p.amount_paid || 0) / 100;
        if (p.product_name && !existing.productsOwned.includes(p.product_name)) {
          existing.productsOwned.push(p.product_name);
        }
      } else {
        paidCustomers.set(email, {
          email,
          stripeCustomerId: p.stripe_customer_id || undefined,
          productsOwned: p.product_name ? [p.product_name] : [],
          totalSpent: (p.amount_paid || 0) / 100,
          source: 'purchases_table',
        });
      }
    }
  }

  // ---- Source 2: Stripe charges (catch anything webhook might have missed) ----
  console.log('   💳 Checking Stripe charges...');
  let chargeCount = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const charges = await stripe.charges.list({
      limit: 100,
      starting_after: startingAfter,
      expand: ['data.customer'],
    });

    for (const charge of charges.data) {
      if (charge.status !== 'succeeded') continue;
      chargeCount++;

      const customer = charge.customer as Stripe.Customer | null;
      if (!customer || typeof customer === 'string') continue;
      if (!customer.email) continue;

      const email = customer.email.toLowerCase();
      const existing = paidCustomers.get(email);

      if (existing) {
        if (!existing.stripeCustomerId) {
          existing.stripeCustomerId = customer.id;
        }
        existing.totalSpent += charge.amount / 100;
        if (charge.description && !existing.productsOwned.includes(charge.description)) {
          existing.productsOwned.push(charge.description);
        }
      } else {
        paidCustomers.set(email, {
          email,
          stripeCustomerId: customer.id,
          productsOwned: charge.description ? [charge.description] : [],
          totalSpent: charge.amount / 100,
          source: 'stripe_charges',
        });
      }
    }

    hasMore = charges.has_more;
    if (charges.data.length > 0) {
      startingAfter = charges.data[charges.data.length - 1].id;
    }
  }
  console.log(`   Found ${chargeCount} successful Stripe charges`);

  // ---- Source 3: Stripe subscriptions (ALL statuses, not just active) ----
  console.log('   🔄 Checking Stripe subscriptions (all statuses)...');
  const subStatuses: Stripe.Subscription.Status[] = ['active', 'past_due', 'canceled', 'unpaid', 'trialing'];
  let subCount = 0;

  for (const status of subStatuses) {
    let subHasMore = true;
    let subStartingAfter: string | undefined;

    while (subHasMore) {
      const subscriptions = await stripe.subscriptions.list({
        limit: 100,
        starting_after: subStartingAfter,
        status,
        expand: ['data.customer'],
      });

      for (const sub of subscriptions.data) {
        subCount++;
        const customer = sub.customer as Stripe.Customer | null;
        if (!customer || typeof customer === 'string') continue;
        if (!customer.email) continue;

        const email = customer.email.toLowerCase();
        const existing = paidCustomers.get(email);

        const productNames = sub.items.data.map(item => {
          const product = item.price.product;
          if (typeof product === 'string') return product;
          return (product as Stripe.Product)?.name || 'Subscription';
        });

        if (existing) {
          if (!existing.stripeCustomerId) {
            existing.stripeCustomerId = customer.id;
          }
          for (const name of productNames) {
            if (!existing.productsOwned.includes(name)) {
              existing.productsOwned.push(name);
            }
          }
        } else {
          paidCustomers.set(email, {
            email,
            stripeCustomerId: customer.id,
            productsOwned: productNames,
            totalSpent: 0,
            source: 'stripe_subscription',
          });
        }
      }

      subHasMore = subscriptions.has_more;
      if (subscriptions.data.length > 0) {
        subStartingAfter = subscriptions.data[subscriptions.data.length - 1].id;
      }
    }
  }
  console.log(`   Found ${subCount} subscriptions (all statuses)`);

  console.log(`\n   📊 Total unique paid customers: ${paidCustomers.size}`);

  return Array.from(paidCustomers.values());
}

// ============================================================
// STEP 2: TAG PAID CUSTOMERS IN DATABASE
// ============================================================

async function tagPaidCustomers(
  paidCustomers: PaidCustomer[]
): Promise<{ matched: CohortAssignment[]; unmatched: PaidCustomer[] }> {
  console.log('\n🏷️  Step 2: Tagging paid customers...');

  const supabase = getSupabase();
  const matched: CohortAssignment[] = [];
  const unmatched: PaidCustomer[] = [];

  // Get all user emails from database
  const { data: users, error } = await supabase
    .from('user_notification_settings')
    .select('user_email')
    .eq('is_active', true);

  if (error) throw error;

  const userEmails = new Set(users?.map(u => u.user_email.toLowerCase()) || []);
  console.log(`   Found ${userEmails.size} active users in database`);

  for (const customer of paidCustomers) {
    if (userEmails.has(customer.email)) {
      matched.push({
        email: customer.email,
        cohort: 'paid_existing',
        reason: 'paid_customer',
        stripeCustomerId: customer.stripeCustomerId,
        productsOwned: customer.productsOwned,
      });
    } else {
      unmatched.push(customer);
    }
  }

  console.log(`   ✅ Matched: ${matched.length} paid customers have user accounts`);
  console.log(`   ⚠️  Unmatched: ${unmatched.length} paid customers without user accounts`);

  if (!DRY_RUN) {
    // Update database for matched customers
    for (const assignment of matched) {
      await supabase
        .from('user_notification_settings')
        .update({
          experiment_cohort: 'paid_existing',
          cohort_assigned_at: new Date().toISOString(),
          paid_status: true,
          stripe_customer_id: assignment.stripeCustomerId || null,
          products_owned: assignment.productsOwned || [],
        })
        .eq('user_email', assignment.email);

      // Log the assignment
      await supabase.from('experiment_log').insert({
        user_email: assignment.email,
        action: 'assign',
        cohort_before: null,
        cohort_after: 'paid_existing',
        reason: 'paid_customer',
        metadata: {
          stripe_customer_id: assignment.stripeCustomerId,
          products_owned: assignment.productsOwned,
        },
      });
    }
    console.log(`   ✅ Updated ${matched.length} paid customers in database`);
  } else {
    console.log(`   [DRY RUN] Would update ${matched.length} paid customers`);
  }

  return { matched, unmatched };
}

// ============================================================
// STEP 3: IDENTIFY FREE BETA USERS
// ============================================================

async function fetchFreeBetaUsers(): Promise<User[]> {
  console.log('\n👥 Step 3: Identifying free beta users for A/B/Hold test...');

  const supabase = getSupabase();

  // Get all active users who are NOT paid
  const { data: users, error } = await supabase
    .from('user_notification_settings')
    .select('*')
    .eq('is_active', true)
    .or('paid_status.is.null,paid_status.eq.false')
    .or('experiment_cohort.is.null,experiment_cohort.neq.paid_existing');

  if (error) throw error;

  // Filter out anyone already tagged as paid
  const freeUsers = (users || []).filter(u =>
    u.experiment_cohort !== 'paid_existing' && !u.paid_status
  );

  console.log(`   Found ${freeUsers.length} free beta users available for experiment`);

  return freeUsers as User[];
}

// ============================================================
// STEP 4: STRATIFIED RANDOM ASSIGNMENT
// Using total_alerts_sent (already populated) instead of alerts_opened_30d
// ============================================================

function assignCohorts(users: User[]): CohortAssignment[] {
  console.log('\n🎲 Step 4: Stratified random assignment...');
  console.log(`   Stratifying by: total_alerts_sent (engagement proxy)`);

  // Sort by engagement (total_alerts_sent descending)
  const sorted = [...users].sort((a, b) =>
    (b.total_alerts_sent || 0) - (a.total_alerts_sent || 0)
  );

  const assignments: CohortAssignment[] = [];

  // Assign in blocks of 18: 8 briefings, 8 alerts, 2 hold
  for (let i = 0; i < sorted.length; i++) {
    const user = sorted[i];
    const posInBlock = i % BLOCK_SIZE;

    let cohort: string;
    if (posInBlock < COHORT_RATIOS.briefings) {
      cohort = 'experiment_briefings';
    } else if (posInBlock < COHORT_RATIOS.briefings + COHORT_RATIOS.alerts) {
      cohort = 'experiment_alerts';
    } else {
      cohort = 'experiment_hold';
    }

    assignments.push({
      email: user.user_email,
      cohort,
      reason: 'stratified_random_assignment',
    });
  }

  // Count by cohort
  const counts = {
    experiment_briefings: assignments.filter(a => a.cohort === 'experiment_briefings').length,
    experiment_alerts: assignments.filter(a => a.cohort === 'experiment_alerts').length,
    experiment_hold: assignments.filter(a => a.cohort === 'experiment_hold').length,
  };

  console.log(`   Briefings cohort: ${counts.experiment_briefings} users`);
  console.log(`   Alerts cohort: ${counts.experiment_alerts} users`);
  console.log(`   Hold cohort: ${counts.experiment_hold} users`);

  return assignments;
}

async function applyFreeUserAssignments(assignments: CohortAssignment[]): Promise<void> {
  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would assign ${assignments.length} free users to cohorts`);
    return;
  }

  const supabase = getSupabase();

  for (const assignment of assignments) {
    await supabase
      .from('user_notification_settings')
      .update({
        experiment_cohort: assignment.cohort,
        cohort_assigned_at: new Date().toISOString(),
        beta_pioneer: true,
      })
      .eq('user_email', assignment.email);

    await supabase.from('experiment_log').insert({
      user_email: assignment.email,
      action: 'assign',
      cohort_before: null,
      cohort_after: assignment.cohort,
      reason: 'stratified_random_assignment',
    });
  }

  console.log(`   ✅ Applied ${assignments.length} cohort assignments`);
}

// ============================================================
// STEP 5: VERIFICATION REPORT
// ============================================================

async function generateVerificationReport(
  paidAssignments: CohortAssignment[],
  freeAssignments: CohortAssignment[],
  freeUsers: User[]
): Promise<void> {
  console.log('\n📊 Step 5: Verification Report');
  console.log('='.repeat(60));

  // Build user lookup for free users
  const userLookup = new Map<string, User>();
  for (const user of freeUsers) {
    userLookup.set(user.user_email, user);
  }

  // Group assignments by cohort
  const cohorts: Record<string, CohortAssignment[]> = {
    paid_existing: paidAssignments,
    experiment_briefings: freeAssignments.filter(a => a.cohort === 'experiment_briefings'),
    experiment_alerts: freeAssignments.filter(a => a.cohort === 'experiment_alerts'),
    experiment_hold: freeAssignments.filter(a => a.cohort === 'experiment_hold'),
  };

  // Calculate stats for each cohort
  const stats: Record<string, CohortStats> = {};

  for (const [cohortName, assignments] of Object.entries(cohorts)) {
    if (cohortName === 'paid_existing') {
      stats[cohortName] = {
        count: assignments.length,
        avgAlertsSent: 0,
        certDistribution: {},
        topNaics: {},
      };
      continue;
    }

    const users = assignments.map(a => userLookup.get(a.email)).filter(Boolean) as User[];

    // Average alerts sent (using total_alerts_sent)
    const totalSent = users.reduce((sum, u) => sum + (u.total_alerts_sent || 0), 0);
    const avgSent = users.length > 0 ? totalSent / users.length : 0;

    // Certification distribution (using business_type field)
    const certCounts: Record<string, number> = {
      '8(a)': 0,
      'SDVOSB': 0,
      'WOSB': 0,
      'HUBZone': 0,
      'none': 0,
    };

    for (const user of users) {
      const bt = user.business_type?.toUpperCase() || '';
      if (bt.includes('8(A)') || bt.includes('8A')) {
        certCounts['8(a)']++;
      } else if (bt.includes('SDVOSB')) {
        certCounts['SDVOSB']++;
      } else if (bt.includes('WOSB') || bt.includes('EDWOSB')) {
        certCounts['WOSB']++;
      } else if (bt.includes('HUBZONE')) {
        certCounts['HUBZone']++;
      } else {
        certCounts['none']++;
      }
    }

    // Top NAICS
    const naicsCounts: Record<string, number> = {};
    for (const user of users) {
      for (const naics of user.naics_codes || []) {
        naicsCounts[naics] = (naicsCounts[naics] || 0) + 1;
      }
    }
    const topNaics = Object.entries(naicsCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

    stats[cohortName] = {
      count: users.length,
      avgAlertsSent: avgSent,
      certDistribution: certCounts,
      topNaics,
    };
  }

  // Print summary
  console.log('\n📈 COHORT COUNTS:');
  console.log(`   paid_existing:        ${stats.paid_existing.count} users`);
  console.log(`   experiment_briefings: ${stats.experiment_briefings.count} users`);
  console.log(`   experiment_alerts:    ${stats.experiment_alerts.count} users`);
  console.log(`   experiment_hold:      ${stats.experiment_hold.count} users`);
  console.log(`   TOTAL:                ${Object.values(stats).reduce((s, c) => s + c.count, 0)} users`);

  // Print engagement comparison for free cohorts
  console.log('\n📧 ENGAGEMENT (avg total_alerts_sent):');
  for (const cohort of ['experiment_briefings', 'experiment_alerts', 'experiment_hold']) {
    console.log(`   ${cohort}: ${stats[cohort].avgAlertsSent.toFixed(2)}`);
  }

  // Check balance
  const avgEngagement = (
    stats.experiment_briefings.avgAlertsSent +
    stats.experiment_alerts.avgAlertsSent +
    stats.experiment_hold.avgAlertsSent
  ) / 3;

  const imbalances: string[] = [];
  for (const cohort of ['experiment_briefings', 'experiment_alerts', 'experiment_hold']) {
    if (avgEngagement > 0) {
      const diff = Math.abs(stats[cohort].avgAlertsSent - avgEngagement) / avgEngagement * 100;
      if (diff > 10) {
        imbalances.push(`${cohort} is ${diff.toFixed(1)}% off from average engagement`);
      }
    }
  }

  // Print certification distribution
  console.log('\n🏷️  SET-ASIDE / BUSINESS TYPE:');
  console.log('   Cohort               | 8(a)  | SDVOSB | WOSB  | HUBZone | None');
  console.log('   ' + '-'.repeat(65));
  for (const cohort of ['experiment_briefings', 'experiment_alerts', 'experiment_hold']) {
    const cert = stats[cohort].certDistribution;
    const total = stats[cohort].count;
    const pct = (n: number) => total > 0 ? `${(n / total * 100).toFixed(1)}%` : '0%';
    console.log(`   ${cohort.padEnd(20)} | ${pct(cert['8(a)']).padStart(5)} | ${pct(cert['SDVOSB']).padStart(6)} | ${pct(cert['WOSB']).padStart(5)} | ${pct(cert['HUBZone']).padStart(7)} | ${pct(cert['none']).padStart(5)}`);
  }

  // Print top NAICS
  console.log('\n📋 TOP 5 NAICS CODES PER COHORT:');
  for (const cohort of ['experiment_briefings', 'experiment_alerts', 'experiment_hold']) {
    console.log(`   ${cohort}:`);
    const naics = stats[cohort].topNaics;
    if (Object.keys(naics).length === 0) {
      console.log('      (no NAICS data)');
    } else {
      for (const [code, count] of Object.entries(naics)) {
        console.log(`      ${code}: ${count} users`);
      }
    }
  }

  // Print imbalances
  if (imbalances.length > 0) {
    console.log('\n⚠️  IMBALANCE WARNINGS:');
    for (const warning of imbalances) {
      console.log(`   - ${warning}`);
    }
  } else {
    console.log('\n✅ All cohorts are within 10% balance threshold');
  }

  console.log('\n' + '='.repeat(60));
}

// ============================================================
// STEP 6: RESEND AUDIENCE SYNC
// ============================================================

async function syncResendAudiences(
  paidAssignments: CohortAssignment[],
  freeAssignments: CohortAssignment[]
): Promise<void> {
  console.log('\n📬 Step 6: Syncing Resend audiences...');

  if (DRY_RUN) {
    console.log('   [DRY RUN] Would sync audiences:');
    console.log(`      ${RESEND_AUDIENCE_NAMES.paid}: ${paidAssignments.length} contacts`);
    console.log(`      ${RESEND_AUDIENCE_NAMES.briefings}: ${freeAssignments.filter(a => a.cohort === 'experiment_briefings').length} contacts`);
    console.log(`      ${RESEND_AUDIENCE_NAMES.alerts}: ${freeAssignments.filter(a => a.cohort === 'experiment_alerts').length} contacts`);
    console.log(`      ${RESEND_AUDIENCE_NAMES.hold}: ${freeAssignments.filter(a => a.cohort === 'experiment_hold').length} contacts`);
    return;
  }

  const resend = getResend();

  // Create or get audiences
  const audienceIds: Record<string, string> = {};

  // List existing audiences
  const { data: existingAudiences } = await resend.audiences.list();

  for (const [key, name] of Object.entries(RESEND_AUDIENCE_NAMES)) {
    const existing = existingAudiences?.data?.find(a => a.name === name);
    if (existing) {
      audienceIds[key] = existing.id;
      console.log(`   Found existing audience: ${name} (${existing.id})`);
    } else {
      const { data: newAudience } = await resend.audiences.create({ name });
      if (newAudience?.id) {
        audienceIds[key] = newAudience.id;
        console.log(`   Created new audience: ${name} (${newAudience.id})`);
      }
    }
  }

  // Group assignments
  const groups: Record<string, string[]> = {
    paid: paidAssignments.map(a => a.email),
    briefings: freeAssignments.filter(a => a.cohort === 'experiment_briefings').map(a => a.email),
    alerts: freeAssignments.filter(a => a.cohort === 'experiment_alerts').map(a => a.email),
    hold: freeAssignments.filter(a => a.cohort === 'experiment_hold').map(a => a.email),
  };

  // Add contacts to audiences (Resend handles deduplication)
  for (const [key, emails] of Object.entries(groups)) {
    const audienceId = audienceIds[key];
    if (!audienceId) continue;

    let successCount = 0;
    for (const email of emails) {
      try {
        await resend.contacts.create({
          audienceId,
          email,
        });
        successCount++;
      } catch {
        // Contact may already exist, that's fine
      }
    }
    console.log(`   ✅ Synced ${successCount}/${emails.length} contacts to ${RESEND_AUDIENCE_NAMES[key as keyof typeof RESEND_AUDIENCE_NAMES]}`);
  }

  // Verify no overlap
  console.log('   Verifying no user is in multiple audiences...');
  const allAssignedEmails = [...paidAssignments, ...freeAssignments].map(a => a.email);
  const uniqueEmails = new Set(allAssignedEmails);
  if (allAssignedEmails.length !== uniqueEmails.size) {
    console.log(`   ⚠️  WARNING: Found ${allAssignedEmails.length - uniqueEmails.size} duplicate assignments!`);
  } else {
    console.log('   ✅ No duplicates found across audiences');
  }
}

// ============================================================
// SAVE UNMATCHED CUSTOMERS
// ============================================================

function saveUnmatchedCustomers(unmatched: PaidCustomer[]): void {
  if (unmatched.length === 0) return;

  const today = new Date().toISOString().split('T')[0];
  const filename = `scripts/unmatched_stripe_customers_${today}.csv`;

  const csvHeader = 'email,stripe_customer_id,products_owned,total_spent,source\n';
  const csvRows = unmatched.map(c =>
    `"${c.email}","${c.stripeCustomerId || ''}","${c.productsOwned.join('; ')}",${c.totalSpent},"${c.source}"`
  ).join('\n');

  const content = csvHeader + csvRows;

  if (!DRY_RUN) {
    fs.writeFileSync(filename, content);
    console.log(`\n📄 Saved unmatched customers to: ${filename}`);
  } else {
    console.log(`\n📄 [DRY RUN] Would save ${unmatched.length} unmatched customers to: ${filename}`);
    console.log('   First 5 unmatched:');
    for (const c of unmatched.slice(0, 5)) {
      console.log(`      - ${c.email} (${c.productsOwned.join(', ')})`);
    }
    if (unmatched.length > 5) {
      console.log(`      ... and ${unmatched.length - 5} more`);
    }
  }
}

// ============================================================
// ROLLBACK SCRIPT GENERATOR
// ============================================================

function generateRollbackScript(
  paidAssignments: CohortAssignment[],
  freeAssignments: CohortAssignment[]
): string {
  const today = new Date().toISOString().split('T')[0];
  const allEmails = [...paidAssignments, ...freeAssignments].map(a => `'${a.email}'`).join(',\n    ');

  return `-- ROLLBACK SCRIPT FOR EXPERIMENT COHORT ASSIGNMENTS
-- Generated: ${new Date().toISOString()}
--
-- This script reverses all cohort assignments made on ${today}
-- Run this in Supabase SQL Editor if you need to undo the experiment setup

BEGIN;

-- Reset experiment_cohort and cohort_assigned_at for all assigned users
UPDATE user_notification_settings
SET
  experiment_cohort = NULL,
  cohort_assigned_at = NULL,
  beta_pioneer = FALSE
WHERE user_email IN (
    ${allEmails}
);

-- Log the rollback in experiment_log
INSERT INTO experiment_log (user_email, action, cohort_before, cohort_after, reason)
SELECT
  user_email,
  'rollback',
  experiment_cohort,
  NULL,
  'manual_rollback_${today}'
FROM user_notification_settings
WHERE user_email IN (
    ${allEmails}
)
AND experiment_cohort IS NOT NULL;

-- Note: Paid status and Stripe customer ID are NOT reset
-- as those reflect actual payment history

COMMIT;

-- Verify the rollback
SELECT experiment_cohort, COUNT(*)
FROM user_notification_settings
WHERE experiment_cohort IS NOT NULL
GROUP BY experiment_cohort;
`;
}

// ============================================================
// MAIN EXECUTION
// ============================================================

async function main() {
  console.log('🧪 EXPERIMENT COHORT ASSIGNMENT');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be made)' : '⚡ LIVE EXECUTION'}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  try {
    // Step 1: Fetch paid customers from multiple sources
    const paidCustomers = await fetchPaidCustomers();

    // Step 2: Tag paid customers
    const { matched: paidAssignments, unmatched } = await tagPaidCustomers(paidCustomers);

    // Save unmatched customers to CSV
    saveUnmatchedCustomers(unmatched);

    // Step 3: Identify free beta users
    const freeUsers = await fetchFreeBetaUsers();

    // Step 4: Stratified random assignment
    const freeAssignments = assignCohorts(freeUsers);
    await applyFreeUserAssignments(freeAssignments);

    // Step 5: Verification report
    await generateVerificationReport(paidAssignments, freeAssignments, freeUsers);

    // Step 6: Resend sync
    await syncResendAudiences(paidAssignments, freeAssignments);

    // Generate rollback script
    const rollbackScript = generateRollbackScript(paidAssignments, freeAssignments);
    const rollbackPath = `scripts/rollback-cohorts-${new Date().toISOString().split('T')[0]}.sql`;

    if (!DRY_RUN) {
      fs.writeFileSync(rollbackPath, rollbackScript);
      console.log(`\n📝 Rollback script saved to: ${rollbackPath}`);
    } else {
      console.log('\n📝 Rollback script preview (first 20 lines):');
      console.log(rollbackScript.split('\n').slice(0, 20).join('\n'));
      console.log('   ...');
    }

    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ EXPERIMENT COHORT ASSIGNMENT COMPLETE');
    console.log('='.repeat(60));

    if (DRY_RUN) {
      console.log('\n⚠️  This was a DRY RUN. No changes were made.');
      console.log('   To execute for real, run:');
      console.log('   DRY_RUN=false npx tsx scripts/assign-experiment-cohorts.ts');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    process.exit(1);
  }
}

main();
