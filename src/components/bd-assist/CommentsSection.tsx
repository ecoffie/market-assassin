'use client';

import { useState, useEffect, useCallback } from 'react';
import { getMIApiHeaders } from '../app/authHeaders';

interface Comment {
  id: string;
  user_email: string;
  content: string;
  created_at: string;
}

interface CommentsSectionProps {
  pipelineId: string;
  email: string;
}

export default function CommentsSection({ pipelineId, email }: CommentsSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/app/comments?pipeline_id=${pipelineId}&email=${encodeURIComponent(email)}`
      );
      const data = await res.json();
      if (data.success) {
        setComments(data.comments || []);
      }
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, email]);

  useEffect(() => {
    if (pipelineId && email) {
      loadComments();
    }
  }, [pipelineId, email, loadComments]);

  const handlePost = async () => {
    if (!newComment.trim()) return;

    setPosting(true);
    setError(null);

    try {
      const res = await fetch('/api/app/comments', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          pipeline_id: pipelineId,
          content: newComment.trim(),
        }),
      });
      const data = await res.json();

      if (data.success) {
        setComments([...comments, data.comment]);
        setNewComment('');
      } else {
        setError(data.error || 'Failed to post comment');
      }
    } catch (err) {
      setError('Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return;

    try {
      const res = await fetch('/api/app/comments', {
        method: 'DELETE',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, comment_id: commentId }),
      });
      const data = await res.json();

      if (data.success) {
        setComments(comments.filter(c => c.id !== commentId));
      }
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatUserName = (email: string) => {
    return email.split('@')[0];
  };

  if (loading) {
    return (
      <div className="py-4 text-center text-gray-500 text-sm">
        Loading comments...
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 pt-4 mt-4">
      <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <span>💬</span>
        Team Comments
        {comments.length > 0 && (
          <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
            {comments.length}
          </span>
        )}
      </h3>

      {/* Comments List */}
      <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
        {comments.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No comments yet. Start the conversation!</p>
        ) : (
          comments.map(comment => (
            <div key={comment.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-800 text-sm">
                      {formatUserName(comment.user_email)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDate(comment.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>
                </div>
                {comment.user_email === email && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="text-gray-400 hover:text-red-500 text-xs"
                    title="Delete"
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* New Comment Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handlePost();
            }
          }}
          placeholder="Add a comment..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={posting}
        />
        <button
          onClick={handlePost}
          disabled={posting || !newComment.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {posting ? '...' : 'Post'}
        </button>
      </div>

      {error && (
        <p className="text-red-500 text-xs mt-2">{error}</p>
      )}
    </div>
  );
}
