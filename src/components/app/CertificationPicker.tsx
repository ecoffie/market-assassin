'use client';

/**
 * Certification picker — checkboxes for the set-asides + credentials that
 * actually gate a federal bid, with a free-text escape hatch for everything else.
 *
 * WHY NOT JUST A TEXT FIELD (what this replaces)
 * The old input was "Certifications (comma-separated)". What 32 users typed:
 * "WOSB certified by U.S. SBA", "SDVOSB;VOSB;WOSB" (semicolons, not commas),
 * "SDVOSB.WOSB", "SMALL BUSINESS", "M/WBE certified by SBA of NYC", and "NO".
 * None of that can be matched against an opportunity's set_aside_type, so the
 * eligibility filter this data is FOR would silently hide opportunities from
 * firms that qualify.
 *
 * Same lesson as the keyword-blob bug: normalizing dirty data is a backfill,
 * but only fixing INTAKE stops it coming back.
 *
 * DESIGN
 * - Checkboxes emit the exact canonical strings the normalizer recognizes, so
 *   what a user clicks is what matching sees. No parsing round-trip.
 * - Existing free-text the user already saved is PRESERVED in "Other", never
 *   silently dropped — some of it is real (a Florida contractor licence).
 * - Set-asides and credentials are visually separated because they do different
 *   jobs: a set-aside decides IF you may bid, a credential decides whether you
 *   clear a specific solicitation's bar.
 */

import { useMemo } from 'react';
import { Check } from 'lucide-react';

/** Canonical labels. These are what the normalizer matches — keep them in sync. */
const SET_ASIDES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'Small Business', label: 'Small Business', hint: 'SBA size standard for your NAICS' },
  { value: '8(a)', label: '8(a)', hint: 'SBA Business Development program' },
  { value: 'HUBZone', label: 'HUBZone', hint: 'SBA-certified, location-based' },
  { value: 'WOSB', label: 'WOSB', hint: 'Woman-Owned Small Business' },
  { value: 'EDWOSB', label: 'EDWOSB', hint: 'Economically Disadvantaged WOSB' },
  { value: 'SDVOSB', label: 'SDVOSB', hint: 'Service-Disabled Veteran-Owned' },
  { value: 'VOSB', label: 'VOSB', hint: 'Veteran-Owned Small Business' },
  { value: 'SDB', label: 'SDB', hint: 'Small Disadvantaged Business' },
  { value: 'Tribal 8(a)', label: 'Tribal / ANC 8(a)', hint: 'Tribally owned or Alaska Native Corp' },
];

const CREDENTIALS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'FCL', label: 'Facility Clearance (FCL)', hint: 'Required for classified work' },
  { value: 'CMMC', label: 'CMMC', hint: 'DoD cybersecurity maturity' },
  { value: 'ISO 9001', label: 'ISO 9001', hint: 'Quality management' },
  { value: 'ISO 27001', label: 'ISO 27001', hint: 'Information security' },
  { value: 'SOC 2', label: 'SOC 2', hint: 'Service org controls' },
  { value: 'CMMI', label: 'CMMI', hint: 'Process maturity (DEV/SVC)' },
];

const ALL_KNOWN = new Set([...SET_ASIDES, ...CREDENTIALS].map((o) => o.value.toLowerCase()));

/** True if a saved string is one of our checkbox values (case-insensitive). */
function isKnown(entry: string): boolean {
  return ALL_KNOWN.has(entry.trim().toLowerCase());
}

export interface CertificationPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Free-text the user previously saved that isn't a checkbox value. */
  otherRaw: string;
  onOtherChange: (next: string) => void;
}

export default function CertificationPicker({
  value, onChange, otherRaw, onOtherChange,
}: CertificationPickerProps) {
  const selected = useMemo(
    () => new Set((value || []).map((v) => v.trim().toLowerCase())),
    [value],
  );

  const toggle = (v: string) => {
    const has = selected.has(v.toLowerCase());
    // Preserve any entries we don't own (free text lives in `otherRaw`, but a
    // legacy unknown value could still be in `value` on first load).
    const kept = (value || []).filter((x) => x.trim().toLowerCase() !== v.toLowerCase());
    onChange(has ? kept : [...kept, v]);
  };

  const Option = ({ v, label, hint }: { v: string; label: string; hint: string }) => {
    const on = selected.has(v.toLowerCase());
    return (
      <button
        type="button"
        onClick={() => toggle(v)}
        title={hint}
        aria-pressed={on}
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
          on
            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
            : 'border-hairline bg-surface/40 text-ink-soft hover:bg-surface'
        }`}
      >
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            on ? 'border-emerald-400 bg-emerald-500' : 'border-hairline'
          }`}
        >
          {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm leading-tight">{label}</span>
          <span className="block text-[11px] text-faint leading-tight">{hint}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-ink-soft mb-1">Set-aside eligibility</label>
        <p className="text-[11px] text-faint mb-2">
          Used to filter opportunities to what you can actually bid. Check every one you hold.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {SET_ASIDES.map((o) => <Option key={o.value} v={o.value} label={o.label} hint={o.hint} />)}
        </div>
      </div>

      <div>
        <label className="block text-sm text-ink-soft mb-1">Clearances &amp; certifications</label>
        <p className="text-[11px] text-faint mb-2">
          Not set-asides — these gate specific solicitations (classified work, DoD cyber, quality bars).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {CREDENTIALS.map((o) => <Option key={o.value} v={o.value} label={o.label} hint={o.hint} />)}
        </div>
      </div>

      <div>
        <label className="block text-sm text-ink-soft mb-1">Other certifications</label>
        <input
          value={otherRaw}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="State/city programs, licences, anything not listed above"
          className="w-full rounded-lg bg-surface border border-hairline px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
        />
        <p className="mt-1 text-[11px] text-faint">
          Comma-separated. State and city programs (MBE, WBE, SWaM) belong here — they&apos;re real,
          but they don&apos;t gate a federal set-aside.
        </p>
      </div>
    </div>
  );
}

/** Split a saved certifications array into checkbox values vs free text. */
export function splitCertifications(saved: string[] | null | undefined): {
  known: string[];
  otherRaw: string;
} {
  const list = (saved || []).map((s) => String(s).trim()).filter(Boolean);
  return {
    known: list.filter(isKnown),
    otherRaw: list.filter((s) => !isKnown(s)).join(', '),
  };
}
