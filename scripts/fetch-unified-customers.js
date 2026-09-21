const fs = require('fs');

// Stripe API - requires STRIPE_SECRET_KEY env var
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is required');
  process.exit(1);
}

// Supabase API - requires env vars
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

async function fetchStripeCharges() {
  const charges = [];
  let hasMore = true;
  let startingAfter = null;

  console.log('Fetching Stripe charges...');

  while (hasMore) {
    const params = new URLSearchParams({
      limit: '100',
      'expand[]': 'data.customer',
    });
    if (startingAfter) params.append('starting_after', startingAfter);

    const response = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      },
    });

    const data = await response.json();

    if (data.error) {
      console.error('Stripe error:', data.error);
      break;
    }

    // Only successful charges
    const successful = data.data.filter(c => c.status === 'succeeded' && !c.refunded);
    charges.push(...successful);

    hasMore = data.has_more;
    if (data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id;
    }

    console.log(`  Fetched ${charges.length} successful charges so far...`);
  }

  return charges;
}

async function fetchStripeSubscriptions() {
  const subscriptions = [];
  let hasMore = true;
  let startingAfter = null;

  console.log('Fetching Stripe subscriptions...');

  while (hasMore) {
    const params = new URLSearchParams({
      limit: '100',
      status: 'all',
      'expand[]': 'data.customer',
    });
    if (startingAfter) params.append('starting_after', startingAfter);

    const response = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      },
    });

    const data = await response.json();

    if (data.error) {
      console.error('Stripe error:', data.error);
      break;
    }

    subscriptions.push(...data.data);

    hasMore = data.has_more;
    if (data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id;
    }

    console.log(`  Fetched ${subscriptions.length} subscriptions so far...`);
  }

  return subscriptions;
}

async function fetchBriefingUsers() {
  console.log('Fetching briefing/alert users from Supabase...');

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_notification_settings?select=user_email,is_active,alerts_enabled,briefings_enabled,naics_codes&limit=10000`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  const data = await response.json();
  console.log(`  Found ${data.length} users in notification settings`);

  // Create lookup map
  const userMap = {};
  for (const user of data) {
    userMap[user.user_email.toLowerCase()] = {
      isActive: user.is_active,
      alertsEnabled: user.alerts_enabled,
      briefingsEnabled: user.briefings_enabled,
      hasNaics: (user.naics_codes || []).length > 0,
    };
  }

  return userMap;
}

function inferProduct(charge) {
  const amount = charge.amount;
  const description = (charge.description || '').toLowerCase();
  const metadata = charge.metadata || {};

  // Check metadata first
  if (metadata.product_name) return metadata.product_name;
  if (metadata.tier) {
    const tierMap = {
      'assassin_standard': 'Market Assassin Standard',
      'assassin_premium': 'Market Assassin Premium',
      'content_standard': 'Content Reaper Standard',
      'content_full_fix': 'Content Reaper Full Fix',
      'hunter_pro': 'Opportunity Hunter Pro',
      'alert_pro': 'Alert Pro',
      'briefings': 'Market Intelligence',
      'recompete': 'Recompete Tracker',
      'contractor_db': 'Federal Contractor Database',
      'starter_bundle': 'Starter Bundle',
      'pro_giant': 'Pro Giant Bundle',
      'ultimate': 'Ultimate Bundle',
    };
    if (tierMap[metadata.tier]) return tierMap[metadata.tier];
  }

  // Check description
  if (description.includes('market assassin') || description.includes('federal market')) {
    if (amount >= 49700) return 'Market Assassin Premium';
    return 'Market Assassin Standard';
  }
  if (description.includes('content') || description.includes('reaper')) {
    if (amount >= 39700) return 'Content Reaper Full Fix';
    return 'Content Reaper Standard';
  }
  if (description.includes('opportunity') || description.includes('hunter')) return 'Opportunity Hunter Pro';
  if (description.includes('recompete')) return 'Recompete Tracker';
  if (description.includes('database') || description.includes('contractor')) return 'Federal Contractor Database';
  if (description.includes('ultimate')) return 'Ultimate Bundle';
  if (description.includes('pro giant')) return 'Pro Giant Bundle';
  if (description.includes('starter')) return 'Starter Bundle';
  if (description.includes('intelligence') || description.includes('briefing')) return 'Market Intelligence';
  if (description.includes('help center')) return 'Federal Help Center';

  // Fallback by amount
  if (amount === 29700) return 'Market Assassin Standard';
  if (amount === 49700) return 'Market Assassin Premium';
  if (amount === 19700) return 'Content Reaper Standard';
  if (amount === 39700) return 'Content Reaper Full Fix';
  if (amount === 1900) return 'Subscription ($19/mo)';
  if (amount === 4900) return 'Market Intelligence';
  if (amount === 9900) return 'Federal Help Center';
  if (amount === 69700) return 'Starter Bundle';
  if (amount === 99700) return 'Pro Giant Bundle';
  if (amount === 149700) return 'Ultimate Bundle';

  return 'Unknown ($' + (amount/100).toFixed(2) + ')';
}

function escapeCSV(str) {
  if (!str) return '';
  const escaped = String(str).replace(/"/g, '""');
  return '"' + escaped + '"';
}

async function main() {
  // Fetch all data
  const [charges, subscriptions, briefingUsers] = await Promise.all([
    fetchStripeCharges(),
    fetchStripeSubscriptions(),
    fetchBriefingUsers(),
  ]);

  console.log('\nProcessing ' + charges.length + ' charges and ' + subscriptions.length + ' subscriptions...');

  // Build customer map
  const customers = {};

  // Process charges
  for (const charge of charges) {
    const customer = charge.customer;
    const email = (charge.receipt_email || (customer && customer.email) || '').toLowerCase().trim();

    if (!email) continue;

    if (!customers[email]) {
      customers[email] = {
        email: email,
        name: (customer && customer.name) || (charge.billing_details && charge.billing_details.name) || '',
        products: new Set(),
        totalSpend: 0,
        firstPurchase: null,
        lastPurchase: null,
        charges: [],
      };
    }

    const product = inferProduct(charge);
    customers[email].products.add(product);
    customers[email].totalSpend += charge.amount;

    const chargeDate = new Date(charge.created * 1000);
    if (!customers[email].firstPurchase || chargeDate < customers[email].firstPurchase) {
      customers[email].firstPurchase = chargeDate;
    }
    if (!customers[email].lastPurchase || chargeDate > customers[email].lastPurchase) {
      customers[email].lastPurchase = chargeDate;
    }

    customers[email].charges.push({
      date: chargeDate,
      amount: charge.amount,
      product: product,
    });
  }

  // Process subscriptions (for active subscriptions not yet charged or name info)
  for (const sub of subscriptions) {
    const customer = sub.customer;
    const email = (customer && customer.email || '').toLowerCase().trim();

    if (!email) continue;

    if (!customers[email]) {
      customers[email] = {
        email: email,
        name: (customer && customer.name) || '',
        products: new Set(),
        totalSpend: 0,
        firstPurchase: null,
        lastPurchase: null,
        charges: [],
      };
    }

    // Update name if not set
    if (!customers[email].name && customer && customer.name) {
      customers[email].name = customer.name;
    }

    // Add subscription product
    const items = sub.items && sub.items.data;
    const plan = items && items[0] && items[0].price;
    if (plan) {
      const amount = plan.unit_amount;
      if (amount === 1900) customers[email].products.add('OH Pro / Alert Pro Subscription');
      else if (amount === 4900) customers[email].products.add('Market Intelligence Subscription');
      else if (amount === 9900) customers[email].products.add('Federal Help Center Subscription');
    }
  }

  // Convert to array and add briefing status
  const customerList = Object.values(customers)
    .filter(function(c) { return c.totalSpend > 0; }) // Only paying customers
    .map(function(c) {
      const briefingStatus = briefingUsers[c.email];
      return {
        email: c.email,
        name: c.name,
        products: Array.from(c.products),
        totalSpend: c.totalSpend,
        firstPurchase: c.firstPurchase,
        lastPurchase: c.lastPurchase,
        hasBriefingAccount: !!briefingStatus,
        briefingsEnabled: briefingStatus ? briefingStatus.briefingsEnabled : false,
        alertsEnabled: briefingStatus ? briefingStatus.alertsEnabled : false,
        hasNaicsProfile: briefingStatus ? briefingStatus.hasNaics : false,
      };
    })
    .sort(function(a, b) { return b.totalSpend - a.totalSpend; });

  console.log('\nFound ' + customerList.length + ' unique paying customers');

  // Generate CSV
  const csvRows = [
    'Email,Name,Products,Total Spend,First Purchase,Last Purchase,Has Briefing Account,Briefings Enabled,Alerts Enabled,Has NAICS Profile',
  ];

  for (const c of customerList) {
    const row = [
      escapeCSV(c.email),
      escapeCSV(c.name),
      escapeCSV(c.products.join('; ')),
      '$' + (c.totalSpend / 100).toFixed(2),
      c.firstPurchase ? c.firstPurchase.toISOString().split('T')[0] : '',
      c.lastPurchase ? c.lastPurchase.toISOString().split('T')[0] : '',
      c.hasBriefingAccount ? 'Yes' : 'No',
      c.briefingsEnabled ? 'Yes' : 'No',
      c.alertsEnabled ? 'Yes' : 'No',
      c.hasNaicsProfile ? 'Yes' : 'No',
    ];
    csvRows.push(row.join(','));
  }

  const csvContent = csvRows.join('\n');
  const outputPath = 'scripts/paid_customers_unified_2026-04-28.csv';
  fs.writeFileSync(outputPath, csvContent);

  console.log('\nSaved to ' + outputPath);

  // Print summary
  console.log('\n=== SUMMARY ===');
  console.log('Total unique paying customers: ' + customerList.length);
  console.log('Total revenue: $' + (customerList.reduce(function(sum, c) { return sum + c.totalSpend; }, 0) / 100).toFixed(2));
  console.log('With briefing account: ' + customerList.filter(function(c) { return c.hasBriefingAccount; }).length);
  console.log('With briefings enabled: ' + customerList.filter(function(c) { return c.briefingsEnabled; }).length);
  console.log('With NAICS profile: ' + customerList.filter(function(c) { return c.hasNaicsProfile; }).length);

  // Product breakdown
  const productCounts = {};
  for (const c of customerList) {
    for (const p of c.products) {
      productCounts[p] = (productCounts[p] || 0) + 1;
    }
  }
  console.log('\n=== PRODUCTS ===');
  Object.entries(productCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .forEach(function(entry) {
      console.log('  ' + entry[0] + ': ' + entry[1]);
    });
}

main().catch(console.error);
