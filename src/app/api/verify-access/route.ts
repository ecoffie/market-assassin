import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase/client';
import { PRODUCTS } from '@/lib/lemonsqueezy';

// Check if a user has access to a product
export async function POST(request: NextRequest) {
  try {
    const { email, productId, licenseKey } = await request.json();

    if (!email && !licenseKey) {
      return NextResponse.json(
        { error: 'Email or license key required' },
        { status: 400 }
      );
    }

    if (!productId) {
      return NextResponse.json(
        { error: 'Product ID required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Check by email
    if (email) {
      const { data: purchases, error } = await supabase
        .from('purchases')
        .select('*')
        .eq('user_email', email.toLowerCase())
        .eq('status', 'completed');

      if (error) {
        console.error('Error checking access:', error);
        return NextResponse.json(
          { error: 'Failed to verify access' },
          { status: 500 }
        );
      }

      // Check if user has direct access to the product
      const hasDirectAccess = purchases?.some(p => p.product_id === productId);

      if (hasDirectAccess) {
        return NextResponse.json({
          hasAccess: true,
          accessType: 'purchase',
          productId,
        });
      }

      // Check if user has access via a bundle
      const userProductIds = purchases?.map(p => p.product_id) || [];

      for (const [, product] of Object.entries(PRODUCTS)) {
        if ('includes' in product && product.includes) {
          const bundleIncludes = product.includes as readonly string[];
          if (
            bundleIncludes.includes(productId) &&
            userProductIds.includes(product.id)
          ) {
            return NextResponse.json({
              hasAccess: true,
              accessType: 'bundle',
              bundleId: product.id,
              productId,
            });
          }
        }
      }

      return NextResponse.json({
        hasAccess: false,
        productId,
      });
    }

    // Check by license key
    if (licenseKey) {
      const { data: purchase, error } = await supabase
        .from('purchases')
        .select('*')
        .eq('license_key', licenseKey)
        .eq('status', 'completed')
        .single();

      if (error || !purchase) {
        return NextResponse.json({
          hasAccess: false,
          productId,
        });
      }

      // Check if this license grants access to the requested product
      if (purchase.product_id === productId) {
        return NextResponse.json({
          hasAccess: true,
          accessType: 'license',
          email: purchase.user_email,
          productId,
        });
      }

      // Check bundle access
      for (const [, product] of Object.entries(PRODUCTS)) {
        if ('includes' in product && product.includes) {
          const bundleIncludes = product.includes as readonly string[];
          if (
            bundleIncludes.includes(productId) &&
            purchase.product_id === product.id
          ) {
            return NextResponse.json({
              hasAccess: true,
              accessType: 'bundle-license',
              bundleId: product.id,
              email: purchase.user_email,
              productId,
            });
          }
        }
      }

      return NextResponse.json({
        hasAccess: false,
        productId,
      });
    }

    return NextResponse.json({ hasAccess: false });
  } catch (error) {
    console.error('Access verification error:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}

// Get all products a user has access to
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    const { data: purchases, error } = await supabase
      .from('purchases')
      .select('product_id, product_name, created_at, license_key')
      .eq('user_email', email.toLowerCase())
      .eq('status', 'completed');

    if (error) {
      console.error('Error fetching purchases:', error);
      return NextResponse.json(
        { error: 'Failed to fetch purchases' },
        { status: 500 }
      );
    }

    // Expand bundle products
    const accessibleProducts: string[] = [];

    for (const purchase of purchases || []) {
      accessibleProducts.push(purchase.product_id);

      // Check if it's a bundle and add included products
      for (const [, product] of Object.entries(PRODUCTS)) {
        if (
          product.id === purchase.product_id &&
          'includes' in product &&
          product.includes
        ) {
          accessibleProducts.push(...(product.includes as readonly string[]));
        }
      }
    }

    // Remove duplicates
    const uniqueProducts = [...new Set(accessibleProducts)];

    return NextResponse.json({
      email,
      purchases: purchases || [],
      accessibleProducts: uniqueProducts,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch access' },
      { status: 500 }
    );
  }
}
