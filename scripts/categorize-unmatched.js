const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function categorizeUnmatched() {
  console.log('=== UNMATCHED STRIPE CUSTOMER ANALYSIS ===\n');

  // 1. Get all users from database
  const { data: users } = await supabase
    .from('user_notification_settings')
    .select('user_email');

  const userEmails = new Set(users.map(u => u.user_email.toLowerCase().trim()));
  const userEmailsMap = new Map(users.map(u => [u.user_email.toLowerCase().trim(), u.user_email]));

  console.log('Users in notification settings:', userEmails.size);

  // 2. Get ALL Stripe customers with their payment history
  const customerData = new Map();

  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const batch = await stripe.customers.list({
      limit: 100,
      starting_after: startingAfter,
      expand: ['data.subscriptions'],
    });

    for (const customer of batch.data) {
      if (!customer.email) continue;

      const email = customer.email.toLowerCase().trim();
      customerData.set(email, {
        id: customer.id,
        email: customer.email,
        emailNormalized: email,
        name: customer.name,
        created: customer.created,
        subscriptions: customer.subscriptions?.data || [],
        charges: [],
        totalPaid: 0,
        refundedAmount: 0,
        latestPayment: 0,
        hasActiveSubscription: false,
        products: new Set(),
      });
    }

    hasMore = batch.has_more;
    if (hasMore) startingAfter = batch.data[batch.data.length - 1].id;
  }

  console.log('Stripe customers with email:', customerData.size);

  // 3. Get all charges and enrich customer data
  hasMore = true;
  startingAfter = undefined;

  while (hasMore) {
    const batch = await stripe.charges.list({
      limit: 100,
      starting_after: startingAfter,
    });

    for (const charge of batch.data) {
      const email = (charge.billing_details?.email || charge.receipt_email || '').toLowerCase().trim();
      if (!email || !customerData.has(email)) continue;

      const customer = customerData.get(email);
      customer.charges.push({
        amount: charge.amount,
        status: charge.status,
        refunded: charge.refunded,
        disputed: charge.disputed,
        created: charge.created,
        description: charge.description,
      });

      if (charge.status === 'succeeded') {
        customer.totalPaid += charge.amount;
        customer.latestPayment = Math.max(customer.latestPayment, charge.created);
        if (charge.description) {
          customer.products.add(charge.description);
        }
      }

      if (charge.refunded) {
        customer.refundedAmount += charge.amount;
      }
    }

    hasMore = batch.has_more;
    if (hasMore) startingAfter = batch.data[batch.data.length - 1].id;
  }

  // 4. Check subscription status
  for (const [email, data] of customerData) {
    data.hasActiveSubscription = data.subscriptions.some(s =>
      s.status === 'active' || s.status === 'trialing' || s.status === 'past_due'
    );
  }

  // 5. Fuzzy matching functions
  function normalizeEmail(email) {
    let normalized = email.toLowerCase().trim();
    const atIndex = normalized.indexOf('@');
    if (atIndex > 0) {
      const plusIndex = normalized.indexOf('+');
      if (plusIndex > 0 && plusIndex < atIndex) {
        normalized = normalized.substring(0, plusIndex) + normalized.substring(atIndex);
      }
    }
    return normalized;
  }

  function findFuzzyMatch(email) {
    const normalized = normalizeEmail(email);

    // Check exact normalized match
    if (userEmails.has(normalized) && normalized !== email.toLowerCase().trim()) {
      return { type: 'alias_removed', match: userEmailsMap.get(normalized) };
    }

    // Check common domain typos
    const typoPatterns = [
      [/@gmail\.com$/, '@gmai.com'],
      [/@gmai\.com$/, '@gmail.com'],
      [/@gmail\.com$/, '@gmial.com'],
      [/@gmial\.com$/, '@gmail.com'],
      [/@yahoo\.com$/, '@yaho.com'],
      [/@yaho\.com$/, '@yahoo.com'],
      [/@hotmail\.com$/, '@hotmai.com'],
      [/@hotmai\.com$/, '@hotmail.com'],
      [/@outlook\.com$/, '@outloo.com'],
      [/@outloo\.com$/, '@outlook.com'],
    ];

    for (const [pattern, replacement] of typoPatterns) {
      if (pattern.test(email)) {
        const fixed = email.replace(pattern, replacement);
        if (userEmails.has(fixed)) {
          return { type: 'typo', match: userEmailsMap.get(fixed) };
        }
      }
    }

    // Check if local part matches with different domain
    const localPart = email.split('@')[0];
    for (const userEmail of userEmails) {
      const userLocal = userEmail.split('@')[0];
      if (localPart === userLocal && localPart.length > 5) {
        return { type: 'different_domain', match: userEmailsMap.get(userEmail) };
      }
    }

    return null;
  }

  // 6. Categorize unmatched customers
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - (365 * 24 * 60 * 60);

  const categories = {
    fullyRefunded: [],
    emailMismatch: [],
    activeSubscriber: [],
    recentPurchaser: [],  // Last 12 months
    stalePurchaser: [],   // >12 months ago
    neverPaid: [],        // Created customer but no successful charges
  };

  for (const [email, data] of customerData) {
    // Skip if matched
    if (userEmails.has(email)) continue;

    const entry = {
      email: data.email,
      name: data.name,
      created: new Date(data.created * 1000).toISOString().split('T')[0],
      totalPaid: (data.totalPaid / 100).toFixed(2),
      refundedAmount: (data.refundedAmount / 100).toFixed(2),
      latestPayment: data.latestPayment ? new Date(data.latestPayment * 1000).toISOString().split('T')[0] : 'never',
      chargeCount: data.charges.length,
      hasActiveSubscription: data.hasActiveSubscription,
      products: [...data.products].slice(0, 3),
      fuzzyMatch: null,
    };

    // Check for fuzzy match
    const fuzzyMatch = findFuzzyMatch(email);
    if (fuzzyMatch) {
      entry.fuzzyMatch = fuzzyMatch;
    }

    // Categorize
    if (data.totalPaid > 0 && data.totalPaid === data.refundedAmount) {
      // Fully refunded - exclude
      categories.fullyRefunded.push(entry);
    } else if (fuzzyMatch) {
      // Has a potential match in the database
      categories.emailMismatch.push(entry);
    } else if (data.hasActiveSubscription) {
      // Active subscriber without user account
      categories.activeSubscriber.push(entry);
    } else if (data.latestPayment >= oneYearAgo) {
      // Purchased in last 12 months
      categories.recentPurchaser.push(entry);
    } else if (data.totalPaid > 0) {
      // Paid but >12 months ago
      categories.stalePurchaser.push(entry);
    } else {
      // Never made a successful payment
      categories.neverPaid.push(entry);
    }
  }

  // 7. Output results
  console.log('\n=== CATEGORIZATION RESULTS ===\n');

  console.log('1. FULLY REFUNDED (EXCLUDE from paid cohort):');
  console.log('   Count:', categories.fullyRefunded.length);
  console.log('   Total refunded: $' + categories.fullyRefunded.reduce((sum, e) => sum + parseFloat(e.refundedAmount), 0).toFixed(2));
  if (categories.fullyRefunded.length > 0) {
    console.log('   Sample:');
    for (const e of categories.fullyRefunded.slice(0, 5)) {
      console.log('     ', e.email, '| refunded $' + e.refundedAmount);
    }
  }
  console.log('');

  console.log('2. EMAIL MISMATCH (need to fix matching):');
  console.log('   Count:', categories.emailMismatch.length);
  if (categories.emailMismatch.length > 0) {
    console.log('   Potential fixes:');
    for (const e of categories.emailMismatch.slice(0, 15)) {
      console.log('     ', e.email, '->', e.fuzzyMatch.match, `(${e.fuzzyMatch.type})`);
    }
  }
  console.log('');

  console.log('3. ACTIVE SUBSCRIBERS (need user account):');
  console.log('   Count:', categories.activeSubscriber.length);
  if (categories.activeSubscriber.length > 0) {
    console.log('   These are paying customers without notification settings:');
    for (const e of categories.activeSubscriber.slice(0, 10)) {
      console.log('     ', e.email, '| $' + e.totalPaid, '|', e.products.join(', ').substring(0, 40));
    }
  }
  console.log('');

  console.log('4. RECENT PURCHASERS (last 12 months, cross-product leads):');
  console.log('   Count:', categories.recentPurchaser.length);
  console.log('   Total revenue: $' + categories.recentPurchaser.reduce((sum, e) => sum + parseFloat(e.totalPaid), 0).toFixed(2));
  if (categories.recentPurchaser.length > 0) {
    console.log('   Sample:');
    for (const e of categories.recentPurchaser.slice(0, 10)) {
      console.log('     ', e.email, '| $' + e.totalPaid, '|', e.latestPayment, '|', e.products[0]?.substring(0, 30) || '');
    }
  }
  console.log('');

  console.log('5. STALE PURCHASERS (>12 months ago, low priority):');
  console.log('   Count:', categories.stalePurchaser.length);
  if (categories.stalePurchaser.length > 0) {
    console.log('   Sample:');
    for (const e of categories.stalePurchaser.slice(0, 5)) {
      console.log('     ', e.email, '| $' + e.totalPaid, '|', e.latestPayment);
    }
  }
  console.log('');

  console.log('6. NEVER PAID (customer created but no successful charges):');
  console.log('   Count:', categories.neverPaid.length);
  console.log('   (These are abandoned checkouts or failed payments - EXCLUDE)');
  console.log('');

  // Summary
  console.log('=== SUMMARY ===');
  console.log('Category                    | Count | Action');
  console.log('----------------------------|-------|----------------------------------');
  console.log(`Fully Refunded              | ${String(categories.fullyRefunded.length).padStart(5)} | EXCLUDE (not real customers)`);
  console.log(`Email Mismatch              | ${String(categories.emailMismatch.length).padStart(5)} | FIX (update matching logic)`);
  console.log(`Active Subscribers          | ${String(categories.activeSubscriber.length).padStart(5)} | CREATE user accounts`);
  console.log(`Recent Purchasers (<12mo)   | ${String(categories.recentPurchaser.length).padStart(5)} | Cross-product leads`);
  console.log(`Stale Purchasers (>12mo)    | ${String(categories.stalePurchaser.length).padStart(5)} | Low priority / ignore`);
  console.log(`Never Paid                  | ${String(categories.neverPaid.length).padStart(5)} | EXCLUDE (abandoned carts)`);
  console.log('----------------------------|-------|----------------------------------');
  const totalUnmatched = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`TOTAL UNMATCHED             | ${String(totalUnmatched).padStart(5)} |`);

  // Recommendation
  console.log('\n=== RECOMMENDATIONS ===');
  const excludeCount = categories.fullyRefunded.length + categories.neverPaid.length;
  const fixCount = categories.emailMismatch.length;
  const createCount = categories.activeSubscriber.length;
  const crossProductCount = categories.recentPurchaser.length;

  console.log(`1. EXCLUDE ${excludeCount} records (refunded + never paid)`);
  console.log(`2. FIX ${fixCount} email mismatches to improve matching`);
  console.log(`3. CREATE user accounts for ${createCount} active subscribers`);
  console.log(`4. ${crossProductCount} recent purchasers are cross-product leads (may not use alert tools)`);
  console.log(`5. ${categories.stalePurchaser.length} stale purchasers can be ignored`);

  // Save detailed report
  fs.writeFileSync(
    'scripts/unmatched_categorized_2026-04-28.json',
    JSON.stringify(categories, null, 2)
  );
  console.log('\nDetailed report saved to: scripts/unmatched_categorized_2026-04-28.json');
}

categorizeUnmatched().catch(console.error);
