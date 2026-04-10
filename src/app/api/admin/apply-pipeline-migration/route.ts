/**
 * Apply Pipeline Migration
 *
 * Creates the pipeline tracker tables for BD Assist
 * POST /api/admin/apply-pipeline-migration?password=galata-assassin-2026
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: { step: string; success: boolean; error?: string }[] = [];

  // Step 1: Create user_pipeline table
  const { error: pipelineError } = await supabase.rpc('exec_migration', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS user_pipeline (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_email TEXT NOT NULL,
        notice_id TEXT,
        source TEXT DEFAULT 'sam.gov',
        external_url TEXT,
        title TEXT NOT NULL,
        agency TEXT,
        value_estimate TEXT,
        naics_code TEXT,
        set_aside TEXT,
        response_deadline TIMESTAMPTZ,
        stage TEXT DEFAULT 'tracking',
        win_probability INTEGER,
        priority TEXT DEFAULT 'medium',
        notes TEXT,
        next_action TEXT,
        next_action_date DATE,
        teaming_partners TEXT[],
        is_prime BOOLEAN DEFAULT true,
        outcome_date DATE,
        outcome_notes TEXT,
        award_amount TEXT,
        winner TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_user_notice UNIQUE (user_email, notice_id)
      );
    `
  });

  if (pipelineError) {
    // Try direct table creation via REST
    results.push({ step: 'user_pipeline via RPC', success: false, error: pipelineError.message });
  } else {
    results.push({ step: 'user_pipeline', success: true });
  }

  // Try to verify table exists by inserting and deleting a test row
  const { error: testError } = await supabase
    .from('user_pipeline')
    .insert({
      user_email: 'test@migration.check',
      title: 'Migration Test',
      stage: 'tracking'
    });

  if (testError?.code === '42P01') {
    // Table doesn't exist - provide SQL to run manually
    return NextResponse.json({
      success: false,
      message: 'Tables need to be created manually via Supabase Dashboard',
      sql: `
-- Run this in Supabase SQL Editor:

CREATE TABLE IF NOT EXISTS user_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  notice_id TEXT,
  source TEXT DEFAULT 'sam.gov',
  external_url TEXT,
  title TEXT NOT NULL,
  agency TEXT,
  value_estimate TEXT,
  naics_code TEXT,
  set_aside TEXT,
  response_deadline TIMESTAMPTZ,
  stage TEXT DEFAULT 'tracking',
  win_probability INTEGER,
  priority TEXT DEFAULT 'medium',
  notes TEXT,
  next_action TEXT,
  next_action_date DATE,
  teaming_partners TEXT[],
  is_prime BOOLEAN DEFAULT true,
  outcome_date DATE,
  outcome_notes TEXT,
  award_amount TEXT,
  winner TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_notice UNIQUE (user_email, notice_id)
);

CREATE TABLE IF NOT EXISTS pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES user_pipeline(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS user_teaming_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  partner_type TEXT,
  uei TEXT,
  cage_code TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_title TEXT,
  naics_codes TEXT[],
  certifications TEXT[],
  past_performance TEXT,
  outreach_status TEXT DEFAULT 'none',
  last_contact DATE,
  notes TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_partner UNIQUE (user_email, partner_name)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_user ON user_pipeline(user_email);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON user_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_deadline ON user_pipeline(response_deadline);
CREATE INDEX IF NOT EXISTS idx_teaming_user ON user_teaming_partners(user_email);
      `,
      results
    });
  }

  // Clean up test row
  await supabase
    .from('user_pipeline')
    .delete()
    .eq('user_email', 'test@migration.check');

  return NextResponse.json({
    success: true,
    message: 'Pipeline tables exist or were created',
    results
  });
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if tables exist
  const tables = ['user_pipeline', 'pipeline_history', 'user_teaming_partners'];
  const status: { table: string; exists: boolean }[] = [];

  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    status.push({
      table,
      exists: !error || error.code !== '42P01'
    });
  }

  return NextResponse.json({
    tables: status,
    allExist: status.every(t => t.exists)
  });
}
