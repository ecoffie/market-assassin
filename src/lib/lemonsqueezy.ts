// Lemon Squeezy API Client and Utilities

const LEMONSQUEEZY_API_URL = 'https://api.lemonsqueezy.com/v1';

// Product IDs - Update these after creating products in Lemon Squeezy dashboard
export const PRODUCTS = {
  AI_CONTENT_GENERATOR: {
    id: 'ai-content-generator',
    variantId: '1227179', // Content Engine variant
    variantIdFullFix: '1227185', // Full Fix variant
    name: 'AI Content Generator',
    price: 397,
  },
  CONTRACTOR_DATABASE: {
    id: 'contractor-database',
    variantId: '1227200',
    name: 'Contractor Database',
    price: 497,
  },
  RECOMPETE_CONTRACTS: {
    id: 'recompete-contracts',
    variantId: '1227279',
    name: 'Recompete Contracts',
    price: 397,
  },
  MARKET_ASSASSIN_STANDARD: {
    id: 'market-assassin-standard',
    variantId: '1227284',
    name: 'Market Assassin Standard',
    price: 297,
    reports: 4,
  },
  MARKET_ASSASSIN_PREMIUM: {
    id: 'market-assassin-premium',
    variantId: '1227287',
    name: 'Market Assassin Premium',
    price: 497,
    reports: 8,
  },
  GOVCON_STARTER_BUNDLE: {
    id: 'govcon-starter-bundle',
    variantId: '1227736',
    name: 'GovCon Starter Bundle',
    price: 697,
    includes: ['recompete-contracts', 'contractor-database', 'opportunity-hunter-pro'],
  },
  ULTIMATE_GOVCON_BUNDLE: {
    id: 'ultimate-govcon-bundle',
    variantId: '1227743',
    name: 'Ultimate GovCon Bundle',
    price: 997,
    includes: ['contractor-database', 'recompete-contracts', 'market-assassin-standard', 'ai-content-generator'],
  },
  COMPLETE_GOVCON_BUNDLE: {
    id: 'complete-govcon-bundle',
    variantId: '1227745',
    name: 'Complete GovCon Bundle',
    price: 1497,
    includes: ['ai-content-generator', 'contractor-database', 'recompete-contracts', 'market-assassin-premium'],
  },
  OPPORTUNITY_HUNTER_PRO: {
    id: 'opportunity-hunter-pro',
    variantId: '1227153',
    name: 'Opportunity Hunter Pro',
    price: 49,
  },
} as const;

// Get API key
function getApiKey(): string {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey || apiKey === 'your_lemon_squeezy_api_key') {
    throw new Error('LEMONSQUEEZY_API_KEY is not configured');
  }
  return apiKey;
}

// Make authenticated API request to Lemon Squeezy
async function lemonSqueezyFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getApiKey();

  return fetch(`${LEMONSQUEEZY_API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      ...options.headers,
    },
  });
}

// Verify webhook signature
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// Get checkout URL for a product
export async function getCheckoutUrl(
  variantId: string,
  email?: string,
  customData?: Record<string, string>
): Promise<string | null> {
  try {
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;

    const checkoutData: Record<string, unknown> = {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: email || undefined,
          custom: customData || {},
        },
        product_options: {
          redirect_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/purchase/success`,
        },
      },
      relationships: {
        store: {
          data: {
            type: 'stores',
            id: storeId,
          },
        },
        variant: {
          data: {
            type: 'variants',
            id: variantId,
          },
        },
      },
    };

    const response = await lemonSqueezyFetch('/checkouts', {
      method: 'POST',
      body: JSON.stringify({ data: checkoutData }),
    });

    if (!response.ok) {
      console.error('Failed to create checkout:', await response.text());
      return null;
    }

    const data = await response.json();
    return data.data.attributes.url;
  } catch (error) {
    console.error('Error creating checkout:', error);
    return null;
  }
}

// Validate a license key
export async function validateLicenseKey(
  licenseKey: string
): Promise<{ valid: boolean; email?: string; productId?: string }> {
  try {
    const response = await lemonSqueezyFetch('/licenses/validate', {
      method: 'POST',
      body: JSON.stringify({
        license_key: licenseKey,
      }),
    });

    if (!response.ok) {
      return { valid: false };
    }

    const data = await response.json();

    if (data.valid) {
      return {
        valid: true,
        email: data.meta?.customer_email,
        productId: data.meta?.product_id?.toString(),
      };
    }

    return { valid: false };
  } catch (error) {
    console.error('Error validating license:', error);
    return { valid: false };
  }
}

// Activate a license key (for first-time use)
export async function activateLicenseKey(
  licenseKey: string,
  instanceName: string = 'default'
): Promise<{ success: boolean; instanceId?: string }> {
  try {
    const response = await lemonSqueezyFetch('/licenses/activate', {
      method: 'POST',
      body: JSON.stringify({
        license_key: licenseKey,
        instance_name: instanceName,
      }),
    });

    if (!response.ok) {
      return { success: false };
    }

    const data = await response.json();
    return {
      success: data.activated,
      instanceId: data.instance?.id,
    };
  } catch (error) {
    console.error('Error activating license:', error);
    return { success: false };
  }
}

// Webhook event types
export type LemonSqueezyWebhookEvent =
  | 'order_created'
  | 'order_refunded'
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_cancelled'
  | 'subscription_resumed'
  | 'subscription_expired'
  | 'subscription_paused'
  | 'subscription_unpaused'
  | 'license_key_created'
  | 'license_key_updated';

// Webhook payload structure
export interface LemonSqueezyWebhookPayload {
  meta: {
    event_name: LemonSqueezyWebhookEvent;
    custom_data?: Record<string, string>;
  };
  data: {
    id: string;
    type: string;
    attributes: {
      store_id: number;
      customer_id: number;
      order_id?: number;
      order_item_id?: number;
      product_id: number;
      variant_id: number;
      user_name?: string;
      user_email: string;
      status: string;
      license_key?: string;
      key?: string;
      activation_limit?: number;
      instances_count?: number;
      created_at: string;
      updated_at: string;
      // Order specific
      total?: number;
      subtotal?: number;
      currency?: string;
      first_order_item?: {
        product_id: number;
        variant_id: number;
        product_name: string;
        variant_name: string;
      };
    };
  };
}

// Parse and type the webhook payload
export function parseWebhookPayload(body: string): LemonSqueezyWebhookPayload {
  return JSON.parse(body) as LemonSqueezyWebhookPayload;
}
