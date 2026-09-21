const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL = 'https://tools.govcongiants.org';

async function generateInvitations() {
  console.log('=== GENERATING SUBSCRIBER INVITATIONS ===\n');

  // 1. Get all users from database
  const { data: users } = await supabase
    .from('user_notification_settings')
    .select('user_email');

  const userEmails = new Set(users.map(u => u.user_email.toLowerCase().trim()));
  console.log('Existing users:', userEmails.size);

  // 2. Get all Stripe customers with active subscriptions
  const activeSubscribers = [];

  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const batch = await stripe.subscriptions.list({
      limit: 100,
      starting_after: startingAfter,
      status: 'all',
      expand: ['data.customer'],
    });

    for (const sub of batch.data) {
      // Only active, trialing, or past_due (still paying)
      if (!['active', 'trialing', 'past_due'].includes(sub.status)) continue;

      const customer = sub.customer;
      if (!customer || typeof customer === 'string') continue;
      if (!customer.email) continue;

      const email = customer.email.toLowerCase().trim();

      // Skip if already has an account
      if (userEmails.has(email)) continue;

      // Get product info
      let productName = 'GovCon Subscription';
      if (sub.items?.data?.[0]?.price?.product) {
        try {
          const product = await stripe.products.retrieve(sub.items.data[0].price.product);
          productName = product.name || productName;
        } catch (e) {}
      }

      // Extract first name from customer name
      let firstName = 'there';
      if (customer.name) {
        firstName = customer.name.split(' ')[0];
        // Capitalize first letter
        firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
      }

      activeSubscribers.push({
        customerId: customer.id,
        email: customer.email,
        firstName,
        fullName: customer.name || '',
        productName,
        subscriptionId: sub.id,
        subscriptionStatus: sub.status,
        created: new Date(sub.created * 1000).toISOString().split('T')[0],
      });
    }

    hasMore = batch.has_more;
    if (hasMore) startingAfter = batch.data[batch.data.length - 1].id;
  }

  // Dedupe by email (keep first occurrence)
  const seen = new Set();
  const deduped = activeSubscribers.filter(sub => {
    const email = sub.email.toLowerCase();
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });

  console.log('Active subscribers without accounts:', deduped.length);

  // 3. Generate magic links for each subscriber
  const invitations = [];

  for (const sub of deduped) {
    // Generate a secure token that encodes customer_id
    // Token format: base64(customer_id:timestamp:hmac)
    const timestamp = Date.now();
    const payload = `${sub.customerId}:${timestamp}`;
    const secret = process.env.STRIPE_SECRET_KEY.slice(-32); // Use last 32 chars as HMAC key
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
    const token = Buffer.from(`${payload}:${hmac}`).toString('base64url');

    const magicLink = `${BASE_URL}/alerts/signup?invite=${token}`;

    invitations.push({
      ...sub,
      token,
      magicLink,
    });
  }

  // 4. Try to store invitation tokens in database (table may not exist yet)
  console.log('\nAttempting to store invitation tokens in database...');
  console.log('(If table doesn\'t exist, tokens are still valid - they\'re self-verifying via HMAC)\n');

  let storedCount = 0;
  let failedCount = 0;

  for (const inv of invitations) {
    const { error } = await supabase
      .from('invitation_tokens')
      .upsert({
        token: inv.token,
        stripe_customer_id: inv.customerId,
        email: inv.email,
        first_name: inv.firstName,
        product_name: inv.productName,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, {
        onConflict: 'token',
      });

    if (error) {
      if (error.message.includes('does not exist')) {
        // Table doesn't exist - that's okay, tokens still work via HMAC
        failedCount++;
      } else {
        console.log('  Warning inserting token for', inv.email, ':', error.message);
        failedCount++;
      }
    } else {
      storedCount++;
    }
  }

  if (storedCount > 0) {
    console.log(`Stored ${storedCount} tokens in database`);
  }
  if (failedCount > 0 && storedCount === 0) {
    console.log('Note: Database table not available. Tokens are still valid via HMAC signature.');
  }

  // 5. Generate CSV
  const csvHeader = 'email,first_name,full_name,product_name,subscription_status,magic_link,stripe_customer_id';
  const csvRows = invitations.map(inv =>
    `"${inv.email}","${inv.firstName}","${inv.fullName}","${inv.productName}","${inv.subscriptionStatus}","${inv.magicLink}","${inv.customerId}"`
  );
  const csvContent = [csvHeader, ...csvRows].join('\n');

  const csvPath = 'scripts/active_subscriber_invitations_2026-04-28.csv';
  fs.writeFileSync(csvPath, csvContent);
  console.log(`\nCSV saved to: ${csvPath}`);

  // 6. Generate email template preview
  console.log('\n=== EMAIL TEMPLATE PREVIEW ===\n');

  const sampleInvite = invitations[0];
  if (sampleInvite) {
    console.log(`To: ${sampleInvite.email}`);
    console.log(`Subject: ${sampleInvite.firstName}, a tool you should already have`);
    console.log('---');
    console.log(`
Hey ${sampleInvite.firstName},

You're a ${sampleInvite.productName} customer, which means you should already have
access to our Market Intelligence briefings — but somehow you slipped
through the cracks and never got invited. That's on us.

Fixing it now. Click below to activate your account:

${sampleInvite.magicLink}

It takes about 5 minutes. You'll add your NAICS codes and set-aside
status, and we'll start sending you:

• Daily Market Intel — ranked opportunities matched to your profile
• Weekly Deep Dive — market analysis and recompete intelligence
• Pursuit Briefs — your top 3 targets with pursuit guidance

No additional payment — this is included with your existing subscription.

If you have any questions or hit any issues, just reply to this email.
I read every response.

— Eric
GovCon Giants
`);
  }

  // 7. Summary
  console.log('\n=== SUMMARY ===');
  console.log('Total invitations generated:', invitations.length);
  console.log('CSV file:', csvPath);
  console.log('Magic links expire in: 30 days');
  console.log('\nNext steps:');
  console.log('1. Review the CSV file');
  console.log('2. Import to email tool (Resend, etc.)');
  console.log('3. Send personalized invitations');
  console.log('4. When user clicks magic link, /alerts/signup will:');
  console.log('   - Verify the token');
  console.log('   - Pre-fill their email');
  console.log('   - Skip payment verification');
  console.log('   - Auto-tag as paid_existing on signup');

  // Save JSON for programmatic use
  fs.writeFileSync(
    'scripts/active_subscriber_invitations_2026-04-28.json',
    JSON.stringify(invitations, null, 2)
  );
  console.log('\nJSON also saved for programmatic use');
}

generateInvitations().catch(console.error);
