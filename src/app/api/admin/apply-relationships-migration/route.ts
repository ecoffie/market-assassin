/**
 * Apply MI Beta Relationships Migration
 *
 * Creates the mi_beta_contacts and related tables
 * GET /api/admin/apply-relationships-migration?password=galata-assassin-2026 - Check status
 * POST /api/admin/apply-relationships-migration?password=galata-assassin-2026 - Get SQL to run
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

const MIGRATION_SQL = `
-- MI Beta Relationships Schema
-- Tables for My Network / Relationships panel

-- Main contacts table
CREATE TABLE IF NOT EXISTS mi_beta_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  contact_type TEXT NOT NULL DEFAULT 'partner',
  full_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  organization TEXT,
  agency TEXT,
  office TEXT,
  sub_tier TEXT,
  source TEXT DEFAULT 'manual',
  source_record_id TEXT,
  notes TEXT,
  owner_email TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contact-to-opportunity links
CREATE TABLE IF NOT EXISTS mi_beta_contact_opportunity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  contact_id UUID NOT NULL REFERENCES mi_beta_contacts(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES user_pipeline(id) ON DELETE CASCADE,
  relationship_role TEXT DEFAULT 'contact',
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_mi_beta_contact_pipeline UNIQUE (contact_id, pipeline_id)
);

-- Pursuit activity log
CREATE TABLE IF NOT EXISTS mi_beta_pursuit_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  pipeline_id UUID,
  actor_email TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_workspace ON mi_beta_contacts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_email ON mi_beta_contacts(email);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contacts_type ON mi_beta_contacts(contact_type);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contact_links_workspace ON mi_beta_contact_opportunity_links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mi_beta_contact_links_pipeline ON mi_beta_contact_opportunity_links(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_mi_beta_pursuit_activity_workspace ON mi_beta_pursuit_activity(workspace_id, created_at DESC);
`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if table exists
  const { error: checkError } = await getSupabase()
    .from('mi_beta_contacts')
    .select('id')
    .limit(1);

  if (!checkError) {
    // Get count
    const { count } = await getSupabase()
      .from('mi_beta_contacts')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      exists: true,
      count: count || 0,
      message: `Table mi_beta_contacts exists with ${count || 0} records`
    });
  }

  if (checkError.code === 'PGRST205') {
    return NextResponse.json({
      exists: false,
      message: 'Table mi_beta_contacts does not exist. POST to this endpoint for SQL to run.',
      sqlEditorUrl: 'https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new'
    });
  }

  return NextResponse.json({
    exists: false,
    error: checkError.message,
    code: checkError.code
  }, { status: 500 });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if table already exists
  const { error: checkError } = await getSupabase()
    .from('mi_beta_contacts')
    .select('id')
    .limit(1);

  if (!checkError) {
    return NextResponse.json({
      success: true,
      message: 'Table mi_beta_contacts already exists',
      action: 'none'
    });
  }

  if (checkError.code !== 'PGRST205') {
    return NextResponse.json({
      success: false,
      error: checkError.message,
      code: checkError.code
    }, { status: 500 });
  }

  // Table doesn't exist - return SQL for manual execution
  return NextResponse.json({
    success: false,
    message: 'Table does not exist. Please run the SQL migration manually in Supabase SQL Editor.',
    sqlEditorUrl: 'https://supabase.com/dashboard/project/krpyelfrbicmvsmwovti/sql/new',
    sql: MIGRATION_SQL
  });
}
