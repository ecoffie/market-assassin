import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  PRODUCTS,
} from '@/lib/lemonsqueezy';

// Initialize Supabase client with service role for webhook operations
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    // Fallback to anon key if service role not available
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      throw new Error('Supabase configuration missing');
    }
    return createClient(supabaseUrl, anonKey);
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

// Map variant IDs to product slugs
function getProductSlugFromVariantId(variantId: number): string[] {
  // Check each product for matching variant
  for (const [, product] of Object.entries(PRODUCTS)) {
    if (product.variantId === variantId.toString()) {
      // If it's a bundle, return all included products
      if ('includes' in product && product.includes) {
        return [...product.includes];
      }
      return [product.id];
    }
  }
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-signature') || '';
    const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    // Verify webhook signature
    if (webhookSecret && webhookSecret !== 'your_webhook_secret') {
      const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        console.error('Invalid webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    const payload = parseWebhookPayload(rawBody);
    const eventName = payload.meta.event_name;

    console.log(`Received Lemon Squeezy webhook: ${eventName}`);

    const supabase = getSupabaseAdmin();

    switch (eventName) {
      case 'order_created': {
        // Handle successful purchase
        const { user_email, order_id, variant_id, total, first_order_item } = payload.data.attributes;

        if (!user_email) {
          console.error('No email in order');
          break;
        }

        // Get product slugs for this variant
        const productSlugs = getProductSlugFromVariantId(variant_id);
        const productName = first_order_item?.product_name || 'Unknown Product';

        // Record purchase for each product in the order
        for (const productSlug of productSlugs) {
          const { error } = await supabase.from('purchases').insert({
            user_email: user_email.toLowerCase(),
            product_id: productSlug,
            order_id: order_id?.toString() || payload.data.id,
            amount_paid: total || 0,
            status: 'completed',
            product_name: productName,
            created_at: new Date().toISOString(),
          });

          if (error) {
            console.error('Error recording purchase:', error);
          } else {
            console.log(`Purchase recorded: ${productSlug} for ${user_email}`);
          }
        }

        break;
      }

      case 'license_key_created': {
        // Handle license key generation
        const { user_email, key, license_key, variant_id } = payload.data.attributes;
        const licenseKey = key || license_key;

        if (!user_email || !licenseKey) {
          console.error('Missing email or license key');
          break;
        }

        // Update purchase with license key
        const productSlugs = getProductSlugFromVariantId(variant_id);

        for (const productSlug of productSlugs) {
          const { error } = await supabase
            .from('purchases')
            .update({ license_key: licenseKey })
            .eq('user_email', user_email.toLowerCase())
            .eq('product_id', productSlug);

          if (error) {
            console.error('Error updating license key:', error);
          }
        }

        break;
      }

      case 'order_refunded': {
        // Handle refund - revoke access
        const { user_email, order_id } = payload.data.attributes;

        if (user_email && order_id) {
          const { error } = await supabase
            .from('purchases')
            .update({ status: 'refunded' })
            .eq('user_email', user_email.toLowerCase())
            .eq('order_id', order_id.toString());

          if (error) {
            console.error('Error processing refund:', error);
          } else {
            console.log(`Refund processed for order ${order_id}`);
          }
        }

        break;
      }

      default:
        console.log(`Unhandled webhook event: ${eventName}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// Lemon Squeezy doesn't use GET, but handle it gracefully
export async function GET() {
  return NextResponse.json({ status: 'Lemon Squeezy webhook endpoint' });
}
