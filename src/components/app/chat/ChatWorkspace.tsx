'use client';
import type { ReactNode } from 'react';

/**
 * The shared chat workspace layout, extracted from Proposal Assist's Manual Drive (approved plan, step 5,
 * 2026-11-16): a conversation column and an optional right context rail (stacks below on small screens).
 * Layout only. It holds no chat state and calls no endpoint, so each surface keeps its own transport:
 * Proposal AI stays the document-generation workspace; Ask Mindy stays the market-intelligence workspace.
 */
export default function ChatWorkspace({
  main,
  rail,
  className = 'bg-ground border border-purple-500/30 rounded-xl overflow-hidden',
}: {
  main: ReactNode;
  rail?: ReactNode;
  className?: string;
}) {
  return (
    <section data-chat-workspace="" className={`${className} grid grid-cols-1 ${rail ? 'lg:grid-cols-[1fr_300px]' : ''}`}>
      {main}
      {rail && (
        <aside className="border-t lg:border-t-0 lg:border-l border-surface bg-ground-deep/40 p-4 flex flex-col gap-5">
          {rail}
        </aside>
      )}
    </section>
  );
}
