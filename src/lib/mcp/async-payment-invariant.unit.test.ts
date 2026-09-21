import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE PAIRED INVARIANT (2026-09-15) — the load-bearing lesson from the payment-gate defect.
 *
 *   Do NOT remove async_payment_succeeded while rejecting unpaid
 *   checkout.session.completed. Doing both STRANDS legitimate delayed-payment customers.
 *
 * Why this is a source-level test and not a behavioural one: the danger is a future
 * cleanup deleting ONE of two pieces that live in DIFFERENT files, each looking redundant
 * on its own. A unit test of either half passes happily while the pair is broken — the
 * refusal still refuses, the handler still handles. Only their CO-EXISTENCE is the
 * invariant, so co-existence is what gets asserted.
 *
 * This was not hypothetical. The gate shipped first WITHOUT the async handler: the webhook
 * handled only checkout.session.completed, so an ACH customer would have been refused on
 * the unpaid event and then never granted. The fix was to ship both as one change.
 *
 * If this test fails, do not delete it. Either restore the missing half, or remove BOTH
 * halves deliberately and delete this test in the same commit with a reason.
 */
const repoRoot = join(__dirname, '..', '..', '..');

/**
 * STRIP COMMENTS BEFORE MATCHING. Proven necessary: the first version of this guard
 * passed with the async handler DELETED, because both files explain the invariant in
 * prose and the regex matched the explanation instead of the code. A guard that cannot
 * detect its own removal is worse than none — it reports safety that isn't there.
 */
function code(relPath: string): string {
  return readFileSync(join(repoRoot, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const topup = code('src/lib/mcp/stripe-topup.ts');
const webhook = code('src/app/api/stripe-webhook/route.ts');

describe('paired invariant: unpaid refusal ⇔ async settlement handler', () => {
  // Match the REFUSAL BEHAVIOUR, not one spelling of the comparison. The first version
  // pinned `payment_status !== 'paid'` and silently went false when the gate was
  // refactored to a local `paymentStatus` variable — so the whole guard stopped running
  // while still reporting green. Assert on the error code the refusal RETURNS instead:
  // that is the contract, and it survives refactors of the condition.
  const refusesUnpaid = /return\s*\{[^}]*error:\s*`unpaid:/.test(topup);
  // Must be an actual event DISPATCH, not a mention: `event.type === '…async_payment_succeeded'`.
  const handlesAsyncSuccess =
    /event\.type\s*===\s*['"]checkout\.session\.async_payment_succeeded['"]/.test(webhook);

  it('if we REFUSE unpaid sessions, we MUST handle async_payment_succeeded', () => {
    if (refusesUnpaid) {
      expect(
        handlesAsyncSuccess,
        'stripe-topup.ts refuses unpaid sessions but stripe-webhook/route.ts no longer handles ' +
          'checkout.session.async_payment_succeeded. A delayed-payment customer (ACH/bank debit) ' +
          'would be refused on the unpaid event and NEVER granted. Restore the handler.',
      ).toBe(true);
    }
  });

  it('the async handler routes through the SAME grant path, so it applies exactly once', () => {
    if (handlesAsyncSuccess) {
      // Both events must reach handleMcpCreditTopup — applyCreditOnce is keyed on
      // session.id, so one settled payment grants once no matter how many events arrive.
      const asyncBlock = webhook.slice(webhook.indexOf('async_payment_succeeded'));
      expect(asyncBlock.slice(0, 600)).toContain('handleMcpCreditTopup');
    }
  });

  it('a FAILED async payment is logged, never silent', () => {
    if (handlesAsyncSuccess) {
      expect(/event\.type\s*===\s*['"]checkout\.session\.async_payment_failed['"]/.test(webhook)).toBe(true);
    }
  });

  it('setup-mode sessions are rejected before any grant', () => {
    expect(topup).toMatch(/ineligible_mode/);
  });

  it('no_payment_required is gated on a genuinely zero total', () => {
    expect(topup).toMatch(/inconsistent_zero_dollar/);
  });
});
