/**
 * Unified Platform MVP Service
 * Created: May 3, 2026
 *
 * Handles contacts, pipeline, and conversations for OpenGovIQ migration.
 */

import { createClient } from '@supabase/supabase-js';
import type {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  PipelineItem,
  CreatePipelineItemInput,
  UpdatePipelineItemInput,
  Conversation,
  CreateConversationInput,
  PipelineStats,
  PipelineHistoryEntry,
} from './types';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// =============================================
// CONTACTS
// =============================================

export async function getContacts(userEmail: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
  return data || [];
}

export async function getContact(id: string, userEmail: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .eq('user_email', userEmail)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch contact: ${error.message}`);
  }
  return data;
}

export async function createContact(input: CreateContactInput): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      ...input,
      source: input.source || 'manual',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create contact: ${error.message}`);
  return data;
}

export async function updateContact(
  id: string,
  userEmail: string,
  input: UpdateContactInput
): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts')
    .update(input)
    .eq('id', id)
    .eq('user_email', userEmail)
    .select()
    .single();

  if (error) throw new Error(`Failed to update contact: ${error.message}`);
  return data;
}

export async function deleteContact(id: string, userEmail: string): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', id)
    .eq('user_email', userEmail);

  if (error) throw new Error(`Failed to delete contact: ${error.message}`);
}

export async function searchContacts(
  userEmail: string,
  query: string
): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_email', userEmail)
    .or(`name.ilike.%${query}%,company.ilike.%${query}%,email.ilike.%${query}%,agency.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to search contacts: ${error.message}`);
  return data || [];
}

// =============================================
// PIPELINE ITEMS (uses existing user_pipeline table)
// =============================================

export async function getPipelineItems(userEmail: string): Promise<PipelineItem[]> {
  const { data, error } = await supabase
    .from('user_pipeline')
    .select('*')
    .eq('user_email', userEmail.toLowerCase())
    .order('response_deadline', { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Failed to fetch pipeline items: ${error.message}`);
  return data || [];
}

export async function getPipelineItem(
  id: string,
  userEmail: string
): Promise<PipelineItem | null> {
  const { data, error } = await supabase
    .from('user_pipeline')
    .select('*')
    .eq('id', id)
    .eq('user_email', userEmail.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch pipeline item: ${error.message}`);
  }
  return data;
}

export async function createPipelineItem(
  input: CreatePipelineItemInput
): Promise<PipelineItem> {
  // Check for duplicate (same user + notice_id)
  if (input.notice_id) {
    const { data: existing } = await supabase
      .from('user_pipeline')
      .select('id')
      .eq('user_email', input.user_email.toLowerCase())
      .eq('notice_id', input.notice_id)
      .single();

    if (existing) {
      throw new Error('This opportunity is already in your pipeline');
    }
  }

  const { data, error } = await supabase
    .from('user_pipeline')
    .insert({
      ...input,
      user_email: input.user_email.toLowerCase(),
      stage: input.stage || 'tracking',
      source: input.source || 'manual',
      priority: input.priority || 'medium',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create pipeline item: ${error.message}`);
  return data;
}

export async function updatePipelineItem(
  id: string,
  userEmail: string,
  input: UpdatePipelineItemInput
): Promise<PipelineItem> {
  const { data, error } = await supabase
    .from('user_pipeline')
    .update(input)
    .eq('id', id)
    .eq('user_email', userEmail.toLowerCase())
    .select()
    .single();

  if (error) throw new Error(`Failed to update pipeline item: ${error.message}`);
  return data;
}

export async function deletePipelineItem(id: string, userEmail: string): Promise<void> {
  const { error } = await supabase
    .from('user_pipeline')
    .delete()
    .eq('id', id)
    .eq('user_email', userEmail.toLowerCase());

  if (error) throw new Error(`Failed to delete pipeline item: ${error.message}`);
}

export async function getPipelineStats(userEmail: string): Promise<PipelineStats> {
  const { data, error } = await supabase
    .from('user_pipeline')
    .select('stage')
    .eq('user_email', userEmail.toLowerCase());

  if (error) throw new Error(`Failed to fetch pipeline stats: ${error.message}`);

  const stats: PipelineStats = {
    tracking: 0,
    pursuing: 0,
    bidding: 0,
    submitted: 0,
    won: 0,
    lost: 0,
    total: 0,
  };

  for (const item of data || []) {
    if (item.stage in stats) {
      stats[item.stage as keyof Omit<PipelineStats, 'total'>]++;
    }
    stats.total++;
  }

  return stats;
}

export async function getPipelineHistory(
  pipelineId: string
): Promise<PipelineHistoryEntry[]> {
  const { data, error } = await supabase
    .from('pipeline_history')
    .select('*')
    .eq('pipeline_id', pipelineId)
    .order('changed_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch pipeline history: ${error.message}`);
  return data || [];
}

// =============================================
// CONVERSATIONS
// =============================================

export async function getConversations(contactId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch conversations: ${error.message}`);
  return data || [];
}

export async function createConversation(
  input: CreateConversationInput
): Promise<Conversation> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      ...input,
      conversation_type: input.conversation_type || 'note',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return data;
}

export async function deleteConversation(
  id: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id)
    .eq('user_email', userEmail);

  if (error) throw new Error(`Failed to delete conversation: ${error.message}`);
}

// =============================================
// BULK IMPORT (for Base44 migration)
// =============================================

export async function bulkImportContacts(
  contacts: CreateContactInput[]
): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;

  // Process in batches of 100
  const batchSize = 100;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize).map((c) => ({
      ...c,
      source: 'base44_import' as const,
    }));

    const { data, error } = await supabase
      .from('contacts')
      .insert(batch)
      .select('id');

    if (error) {
      errors.push(`Batch ${Math.floor(i / batchSize)}: ${error.message}`);
    } else {
      imported += data?.length || 0;
    }
  }

  return { imported, errors };
}

export async function bulkImportPipelineItems(
  items: CreatePipelineItemInput[]
): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;

  const batchSize = 100;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize).map((item) => ({
      ...item,
      user_email: item.user_email.toLowerCase(),
      stage: item.stage || 'tracking',
      source: 'base44_import',
      priority: item.priority || 'medium',
    }));

    const { data, error } = await supabase
      .from('user_pipeline')
      .insert(batch)
      .select('id');

    if (error) {
      errors.push(`Batch ${Math.floor(i / batchSize)}: ${error.message}`);
    } else {
      imported += data?.length || 0;
    }
  }

  return { imported, errors };
}

// =============================================
// EXPORTS
// =============================================

export * from './types';
