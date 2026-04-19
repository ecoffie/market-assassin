/**
 * Business Intelligence Migration Status
 * Checks if user_business_profiles table exists and provides instructions
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      endpoint: '/api/admin/apply-business-intel-migration',
      description: 'Check user_business_profiles table migration status',
      usage: '?password=xxx',
    });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ success: false, error: 'Missing Supabase credentials' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if table exists
  const { error: tableError } = await supabase
    .from('user_business_profiles')
    .select('id')
    .limit(1);

  const tableExists = !tableError || !tableError.message.includes('does not exist');

  // Check if business_description column exists in user_notification_settings
  const { error: settingsError } = await supabase
    .from('user_notification_settings')
    .select('user_email, business_description')
    .limit(1);

  const columnExists = !settingsError || !settingsError.message.includes('business_description');

  if (tableExists && columnExists) {
    return NextResponse.json({
      success: true,
      message: 'All migrations applied successfully',
      status: {
        user_business_profiles: 'exists',
        business_description_column: 'exists',
      },
    });
  }

  return NextResponse.json({
    success: false,
    message: 'Migration needs to be applied manually',
    status: {
      user_business_profiles: tableExists ? 'exists' : 'NEEDS CREATION',
      business_description_column: columnExists ? 'exists' : 'NEEDS CREATION',
    },
    instructions: {
      step1: 'Go to Supabase SQL Editor:',
      url: 'https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new',
      step2: 'Copy the contents of: supabase/migrations/20260419_user_business_intelligence.sql',
      step3: 'Paste and run the SQL',
      step4: 'Refresh this endpoint to verify',
    },
  });
}
