'use client';

/**
 * Copy button for "The address you'll paste". The guide tells people to paste this address
 * (ChatGPT step 2, Other assistants), and selecting a small monospace URL by hand is hard on a
 * phone. Same copy pattern as FirstQuestions: clipboard, "Copied" for 2 s, and a blocked
 * clipboard leaves the address on screen to select.
 */
import { useState } from 'react';

export default function CopyAddressButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the address is on screen and selectable */ }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Address copied' : `Copy the address ${text}`}
      className="shrink-0 rounded-none border border-(--mp-navy) bg-(--mp-navy-wash) px-3 py-1.5 text-[12px] font-semibold text-(--mp-navy) hover:bg-(--mp-surface)"
    >
      {copied ? 'Copied' : 'Copy address'}
    </button>
  );
}
