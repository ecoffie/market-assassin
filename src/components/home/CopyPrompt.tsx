'use client';
import { useState } from 'react';

/** Copy-to-clipboard button for the Ideas Gallery — one click puts the agent prompt on the
 *  clipboard so the user pastes it into their AI agent (drives the activation metric). */
export default function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copybtn"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      aria-label="Copy prompt"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}
