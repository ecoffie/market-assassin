'use client';

/**
 * Threaded comments on a pursuit (Deal Flow Board, Phase 2).
 *
 * Surfaces the already-built /api/app/comments API in the pursuit drawer so a
 * workspace can actually discuss a deal on the card — the thing that turns the board
 * from a solo tracker into a shared workspace. Workspace-access-controlled server-side
 * (same-workspace OR same-user); this component just renders + posts.
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { authedFetch } from '../authHeaders';

interface Comment {
  id: string;
  user_email: string;
  content: string;
  created_at: string;
}

interface PursuitCommentsProps {
  pipelineId: string;
  email: string;
}

function initials(emailAddr: string): string {
  const name = (emailAddr || '').split('@')[0] || '';
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || name[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function PursuitComments({ pipelineId, email }: PursuitCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    try {
      const res = await authedFetch(
        `/api/app/comments?pipeline_id=${encodeURIComponent(pipelineId)}&email=${encodeURIComponent(email)}`,
        email,
      );
      const data = await res.json().catch(() => null);
      if (data?.success) setComments(data.comments || []);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, email]);

  useEffect(() => { load(); }, [load]);

  const post = async () => {
    const content = draft.trim();
    if (!content || posting) return;
    setPosting(true);
    try {
      const res = await authedFetch('/api/app/comments', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pipeline_id: pipelineId, content }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success && data.comment) {
        setComments((prev) => [...prev, data.comment]);
        setDraft('');
      }
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    // Optimistic; server enforces creator-or-admin.
    const prev = comments;
    setComments((c) => c.filter((x) => x.id !== id));
    const res = await authedFetch('/api/app/comments', email, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, comment_id: id }),
    });
    const data = await res.json().catch(() => null);
    if (!data?.success) setComments(prev); // rollback on failure
  };

  const mine = (c: Comment) => c.user_email?.toLowerCase() === email.toLowerCase();

  return (
    <div className="mt-4">
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft mb-2">
        <MessageSquare className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} /> Team discussion {comments.length > 0 && <span className="text-faint">({comments.length})</span>}
      </div>

      <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
        {loading ? (
          <div className="text-xs text-faint">Loading…</div>
        ) : comments.length === 0 ? (
          <div className="text-xs text-faint italic">No comments yet. Start the conversation with your team.</div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 group">
              <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-purple-600/30 text-[10px] font-semibold text-purple-200" title={c.user_email}>
                {initials(c.user_email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-ink-soft truncate">{c.user_email?.split('@')[0]}</span>
                  <span className="text-[10px] text-faint">{timeAgo(c.created_at)}</span>
                  {mine(c) && (
                    <button
                      onClick={() => remove(c.id)}
                      className="ml-auto text-[10px] text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-200 whitespace-pre-wrap break-words">{c.content}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }}
          placeholder="Add a note for your team… (⌘+Enter to send)"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-hairline bg-ground px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
        />
        <button
          onClick={post}
          disabled={!draft.trim() || posting}
          className="shrink-0 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40 transition-colors"
        >
          {posting ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
