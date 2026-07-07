'use client';

import { useEffect, useState, useRef } from 'react';
import { authedFetch } from './authHeaders';

interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'active' | 'invited';
  memberCount: number;
  isPersonal: boolean;
}

interface WorkspaceSwitcherProps {
  email: string | null;
  currentWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string) => void;
  isCollapsed?: boolean;
}

export default function WorkspaceSwitcher({
  email,
  currentWorkspaceId,
  onWorkspaceChange,
  isCollapsed = false,
}: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch workspaces on mount
  useEffect(() => {
    const fetchWorkspaces = async () => {
      if (!email) {
        setLoading(false);
        return;
      }

      try {
        const res = await authedFetch(`/api/app/workspaces?email=${encodeURIComponent(email)}`, email);
        const data = await res.json();

        if (data.success) {
          setWorkspaces(data.workspaces || []);

          // Auto-select first workspace if none selected
          if (!currentWorkspaceId && data.workspaces?.length > 0) {
            onWorkspaceChange(data.workspaces[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to fetch workspaces:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchWorkspaces();
  }, [email, currentWorkspaceId, onWorkspaceChange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);

  // Don't show switcher if only 1 workspace
  if (workspaces.length <= 1) {
    return null;
  }

  if (loading) {
    return (
      <div className="px-4 py-2">
        <div className="h-8 bg-slate-800 rounded animate-pulse" />
      </div>
    );
  }

  if (isCollapsed) {
    // Collapsed view - just show indicator
    return (
      <div className="px-2 py-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-center p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors"
          title={currentWorkspace?.name || 'Switch workspace'}
        >
          <span className="text-lg">
            {currentWorkspace?.isPersonal ? '👤' : '🏢'}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="px-4 py-2 relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">
            {currentWorkspace?.isPersonal ? '👤' : '🏢'}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">
              {currentWorkspace?.name || 'Select workspace'}
            </div>
            {currentWorkspace && !currentWorkspace.isPersonal && (
              <div className="text-[10px] text-slate-500">
                {currentWorkspace.memberCount} {currentWorkspace.memberCount === 1 ? 'member' : 'members'}
              </div>
            )}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-4 right-4 top-full mt-1 py-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50">
          <div className="px-3 py-1.5 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
            Workspaces
          </div>
          {workspaces.map(workspace => (
            <button
              key={workspace.id}
              onClick={() => {
                onWorkspaceChange(workspace.id);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800 transition-colors ${
                workspace.id === currentWorkspaceId ? 'bg-slate-800/50' : ''
              }`}
            >
              <span className="text-sm">
                {workspace.isPersonal ? '👤' : '🏢'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{workspace.name}</div>
                <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                  <span className="capitalize">{workspace.role}</span>
                  {!workspace.isPersonal && (
                    <>
                      <span>•</span>
                      <span>{workspace.memberCount} {workspace.memberCount === 1 ? 'member' : 'members'}</span>
                    </>
                  )}
                </div>
              </div>
              {workspace.id === currentWorkspaceId && (
                <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}

          {/* Pending invitations */}
          {workspaces.some(w => w.status === 'invited') && (
            <>
              <div className="my-1 border-t border-slate-800" />
              <div className="px-3 py-1.5 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                Pending Invitations
              </div>
              {workspaces
                .filter(w => w.status === 'invited')
                .map(workspace => (
                  <div
                    key={`invite-${workspace.id}`}
                    className="px-3 py-2 flex items-center gap-2"
                  >
                    <span className="text-sm">🏢</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-400 truncate">{workspace.name}</div>
                      <div className="text-[10px] text-amber-400">Invitation pending</div>
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
