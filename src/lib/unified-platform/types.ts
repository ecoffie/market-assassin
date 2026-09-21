/**
 * Unified Platform MVP Types
 * Created: May 3, 2026
 */

// =============================================
// CONTACTS
// =============================================

export interface Contact {
  id: string;
  user_email: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  agency?: string;
  notes?: string;
  tags?: string[];
  source: 'manual' | 'base44_import' | 'sam_gov';
  created_at: string;
  updated_at: string;
}

export interface CreateContactInput {
  user_email: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  agency?: string;
  notes?: string;
  tags?: string[];
  source?: Contact['source'];
}

export interface UpdateContactInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  agency?: string;
  notes?: string;
  tags?: string[];
}

// =============================================
// PIPELINE ITEMS (uses existing user_pipeline table)
// =============================================

export type PipelineStage =
  | 'tracking'
  | 'pursuing'
  | 'bidding'
  | 'submitted'
  | 'won'
  | 'lost'
  | 'archived';

export type PipelinePriority = 'low' | 'medium' | 'high' | 'critical';

export interface PipelineItem {
  id: string;
  user_email: string;

  // Opportunity data
  notice_id?: string;  // SAM.gov notice ID
  source?: string;     // sam.gov, grants.gov, manual, base44_import
  external_url?: string;
  title: string;
  agency?: string;
  naics_code?: string;
  set_aside?: string;
  value_estimate?: string;
  response_deadline?: string;

  // Pipeline tracking
  stage: PipelineStage;
  win_probability?: number;
  priority?: PipelinePriority;
  notes?: string;
  next_action?: string;
  next_action_date?: string;

  // Teaming
  teaming_partners?: string[];
  is_prime?: boolean;

  // Outcome
  outcome_date?: string;
  outcome_notes?: string;
  award_amount?: string;
  winner?: string;

  // Metadata
  created_at: string;
  updated_at: string;
}

export interface CreatePipelineItemInput {
  user_email: string;
  notice_id?: string;
  source?: string;
  external_url?: string;
  title: string;
  agency?: string;
  naics_code?: string;
  set_aside?: string;
  value_estimate?: string;
  response_deadline?: string;
  stage?: PipelineStage;
  win_probability?: number;
  priority?: PipelinePriority;
  notes?: string;
}

export interface UpdatePipelineItemInput {
  title?: string;
  agency?: string;
  naics_code?: string;
  set_aside?: string;
  value_estimate?: string;
  response_deadline?: string;
  stage?: PipelineStage;
  win_probability?: number;
  priority?: PipelinePriority;
  notes?: string;
  next_action?: string;
  next_action_date?: string;
  outcome_notes?: string;
  winner?: string;
}

// =============================================
// CONVERSATIONS
// =============================================

export type ConversationType = 'note' | 'email' | 'call' | 'meeting' | 'linkedin';

export interface Conversation {
  id: string;
  contact_id: string;
  user_email: string;
  content: string;
  conversation_type: ConversationType;
  pipeline_id?: string;  // Links to user_pipeline.id
  created_at: string;
}

export interface CreateConversationInput {
  contact_id: string;
  user_email: string;
  content: string;
  conversation_type?: ConversationType;
  pipeline_id?: string;
}

// =============================================
// PIPELINE HISTORY (uses existing pipeline_history table)
// =============================================

export interface PipelineHistoryEntry {
  id: string;
  pipeline_id: string;  // References user_pipeline.id
  from_stage?: PipelineStage;
  to_stage?: PipelineStage;
  notes?: string;
  changed_at: string;
}

// =============================================
// API RESPONSES
// =============================================

export interface PipelineStats {
  tracking: number;
  pursuing: number;
  bidding: number;
  submitted: number;
  won: number;
  lost: number;
  total: number;
}

export interface ContactWithConversations extends Contact {
  conversations: Conversation[];
}

export interface PipelineItemWithHistory extends PipelineItem {
  history: PipelineHistoryEntry[];
}
