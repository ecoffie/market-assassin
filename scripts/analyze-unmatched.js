const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function deepAnalysis() {
  // Get all users
  const { data: users } = await supabase
    .from('user_notification_settings')
    .select('user_email');

  const userEmails = new Set(users.map(u => u.user_email.toLowerCase().trim()));
  console.log('Users in DB:', userEmails.size);

  // Get purchases table
  const { data: purchases } = await supabase
    .from('purchases')
    .select('email, product_name, status, created_at');

  console.log('Purchases in DB:', purchases?.length || 0);

  // Count purchases not in user_notification_settings
  const purchaseEmails = new Set(purchases?.map(p => p.email?.toLowerCase().trim()).filter(Boolean) || []);
  const purchasesNotInUsers = [...purchaseEmails].filter(e => !userEmails.has(e));
  console.log('Purchase emails not in users:', purchasesNotInUsers.length);

  // Get ALL Stripe charges (including test mode)
  const allCharges = { live: 0, test: 0, refunded: 0, failed: 0 };
  const liveEmails = new Set();
  const testEmails = new Set();

  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const batch = await stripe.charges.list({
      limit: 100,
      starting_after: startingAfter,
    });

    for (const charge of batch.data) {
      const email = (charge.billing_details?.email || charge.receipt_email || '').toLowerCase().trim();

      if (charge.livemode) {
        allCharges.live++;
        if (charge.status === 'succeeded' && !charge.refunded && email) {
          liveEmails.add(email);
        }
        if (charge.refunded) allCharges.refunded++;
      } else {
        allCharges.test++;
        if (email) testEmails.add(email);
      }

      if (charge.status === 'failed') allCharges.failed++;
    }

    hasMore = batch.has_more;
    if (hasMore) startingAfter = batch.data[batch.data.length - 1].id;
  }

  console.log('\n=== STRIPE CHARGES BREAKDOWN ===');
  console.log('Live mode charges:', allCharges.live);
  console.log('Test mode charges:', allCharges.test);
  console.log('Refunded (live):', allCharges.refunded);
  console.log('Failed:', allCharges.failed);
  console.log('');
  console.log('Unique live paying emails:', liveEmails.size);
  console.log('Unique test mode emails:', testEmails.size);

  // Get subscriptions
  const subs = { active: 0, canceled: 0, past_due: 0, trialing: 0, other: 0, test: 0 };
  const subEmails = new Set();

  hasMore = true;
  startingAfter = undefined;

  while (hasMore) {
    const batch = await stripe.subscriptions.list({
      limit: 100,
      starting_after: startingAfter,
      status: 'all',
    });

    for (const sub of batch.data) {
      if (!sub.livemode) {
        subs.test++;
        continue;
      }

      if (sub.status === 'active') subs.active++;
      else if (sub.status === 'canceled') subs.canceled++;
      else if (sub.status === 'past_due') subs.past_due++;
      else if (sub.status === 'trialing') subs.trialing++;
      else subs.other++;

      // Get customer email
      try {
        const customer = await stripe.customers.retrieve(sub.customer);
        if (customer.email) {
          subEmails.add(customer.email.toLowerCase().trim());
        }
      } catch (e) {}
    }

    hasMore = batch.has_more;
    if (hasMore) startingAfter = batch.data[batch.data.length - 1].id;
  }

  console.log('\n=== STRIPE SUBSCRIPTIONS BREAKDOWN ===');
  console.log('Active:', subs.active);
  console.log('Canceled:', subs.canceled);
  console.log('Past due:', subs.past_due);
  console.log('Trialing:', subs.trialing);
  console.log('Other:', subs.other);
  console.log('Test mode:', subs.test);
  console.log('Unique subscription emails (live):', subEmails.size);

  // Combine all paid emails (live mode only)
  const allPaidEmails = new Set([...liveEmails, ...subEmails]);
  console.log('\n=== COMBINED PAID EMAILS (live mode) ===');
  console.log('Total unique paid:', allPaidEmails.size);

  // Match against users
  const matched = [...allPaidEmails].filter(e => userEmails.has(e));
  const unmatched = [...allPaidEmails].filter(e => !userEmails.has(e));

  console.log('Matched to user accounts:', matched.length);
  console.log('Unmatched:', unmatched.length);

  // Check all customers to see why 516 was reported
  console.log('\n=== CHECKING ALL STRIPE CUSTOMERS ===');
  const customers = [];
  hasMore = true;
  startingAfter = undefined;

  while (hasMore) {
    const batch = await stripe.customers.list({
      limit: 100,
      starting_after: startingAfter,
    });

    customers.push(...batch.data);
    hasMore = batch.has_more;
    if (hasMore) startingAfter = batch.data[batch.data.length - 1].id;
  }

  console.log('Total Stripe customers:', customers.length);
  console.log('Live mode customers:', customers.filter(c => c.livemode).length);
  console.log('Test mode customers:', customers.filter(c => !c.livemode).length);

  // Count with email
  const liveCustomersWithEmail = customers.filter(c => c.livemode && c.email);
  console.log('Live customers with email:', liveCustomersWithEmail.length);

  // Check which customers are unmatched
  const unmatchedCustomers = liveCustomersWithEmail.filter(c => !userEmails.has(c.email.toLowerCase().trim()));
  console.log('Unmatched live customers:', unmatchedCustomers.length);

  // Save the list for review
  const unmatchedList = unmatchedCustomers.map(c => ({
    email: c.email,
    created: new Date(c.created * 1000).toISOString().split('T')[0],
    name: c.name,
  }));

  require('fs').writeFileSync(
    'scripts/unmatched_customers_detailed.json',
    JSON.stringify(unmatchedList, null, 2)
  );
  console.log('\nSaved unmatched customer list to scripts/unmatched_customers_detailed.json');
}

deepAnalysis().catch(console.error);
