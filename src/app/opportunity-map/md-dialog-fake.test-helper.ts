/**
 * Test double for window.__mdDialog (map-dialog.ts) used by the tests that execute the real Map save handler.
 * It records what each dialog asked, the way the old window.prompt / confirm / alert stubs did:
 *   · input dialogs   → `prompts` (the prefilled name); answered with `name` (or the prefill) + the preselected choice
 *   · one-button info → `alerts`  (the message)
 *   · yes/no dialogs  → `confirms` (the message); answered with `confirmAnswer`
 * `dialogs` keeps every raw options object so a test can assert wording and the frequency choice.
 */
export type MdOpts = {
  title?: string; message?: string; okLabel?: string; cancelLabel?: string; danger?: boolean; hideCancel?: boolean;
  input?: { label?: string; value?: string; maxLength?: number };
  choice?: { label?: string; value?: string; options: { value: string; label: string }[] };
};

export function fakeMdDialog(opts: {
  prompts?: string[]; confirms?: string[]; alerts?: string[];
  confirmAnswer?: boolean; name?: string | null; choice?: string;
} = {}) {
  const dialogs: MdOpts[] = [];
  const fn = (o: MdOpts, cb: (r: unknown) => void) => {
    dialogs.push(o);
    if (o.input) {
      opts.prompts?.push(o.input.value ?? '');
      if (opts.name === null) return cb(null);
      return cb({ value: opts.name ?? o.input.value, choice: opts.choice ?? o.choice?.value });
    }
    if (o.hideCancel) { opts.alerts?.push(o.message ?? ''); return cb({}); }
    opts.confirms?.push(o.message ?? '');
    return cb((opts.confirmAnswer ?? true) ? {} : null);
  };
  return { fn, dialogs };
}
