'use client';

/**
 * SaveContactButton (#40) — the ONE unified "+ Save contact" action, dropped in
 * wherever a person appears (Decision Makers, task-order primes, OSBP, teaming
 * SBLOs, Target List "Who to contact"). Saves to the existing contact CRM
 * (POST /api/app/relationships → mi_beta_contacts) keyed by target_agency, so
 * the contact lands under that agency in My Target List.
 *
 * Eric's architecture: one save action, one backing table, contacts live under
 * the Target List agency. Decision Makers stays the discovery directory.
 */
import { useState, useCallback } from 'react';
import { authedFetch } from '@/components/app/authHeaders';

export interface SaveableContact {
  full_name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  agency?: string | null;          // the target agency this contact belongs under
  office?: string | null;
  source?: string;                  // 'decision_makers' | 'task_order' | 'osbp' | 'sblo' | ...
  source_record_id?: string | null;
}

export default function SaveContactButton({
  contact,
  email,
  className = '',
  size = 'sm',
  onSaved,
}: {
  contact: SaveableContact;
  email: string | null;
  className?: string;
  size?: 'sm' | 'xs';
  onSaved?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = useCallback(async () => {
    if (!email || state === 'saving' || state === 'saved') return;
    setState('saving');
    try {
      const res = await authedFetch('/api/app/relationships', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_contact',
          user_email: email,
          full_name: contact.full_name,
          title: contact.title || null,
          email: contact.email || null,
          phone: contact.phone || null,
          organization: contact.organization || null,
          agency: contact.agency || null,
          target_agency: contact.agency || null,   // pins it under the agency card
          office: contact.office || null,
          source: contact.source || 'manual',
          source_record_id: contact.source_record_id || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && (data?.success ?? true)) {
        setState('saved');
        onSaved?.();
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }, [email, contact, state, onSaved]);

  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs';
  const label =
    state === 'saved' ? '✓ Saved'
    : state === 'saving' ? 'Saving…'
    : state === 'error' ? 'Retry'
    : '+ Save contact';

  return (
    <button
      type="button"
      onClick={save}
      disabled={state === 'saving' || state === 'saved' || !email}
      title={state === 'saved' ? 'Saved to My Target List' : 'Save to My Target List under this agency'}
      className={`shrink-0 rounded font-medium transition-colors ${pad} ${
        state === 'saved'
          ? 'bg-emerald-500/15 text-emerald-300 cursor-default'
          : state === 'error'
          ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
          : 'bg-purple-500/15 text-purple-300 hover:bg-purple-500/25'
      } ${className}`}
    >
      {label}
    </button>
  );
}
