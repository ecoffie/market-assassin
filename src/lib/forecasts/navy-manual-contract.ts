/**
 * Navy LRAE registered as a MANUAL source — the first consumer of the shared
 * manual-source operations layer (src/lib/data-core/manual-source-ops.ts).
 *
 * ⚠️ actionType is `identity_resolution`, NOT `refresh_upload`.
 * Navy passes discovery (we can reliably find and fetch the newest workbook) but
 * FAILS identity: the stored corpus cannot be matched back to the published
 * rows. The proven reconciliation attempt produced matched:0 against 8,821 held
 * rows — a full-corpus duplication had it been allowed to write. Until an
 * identity contract exists, "download the newer file and re-import" is not a
 * repair, it is a corruption. The action type is what stops the alert from
 * saying otherwise.
 */
import type { ManualSourceContract } from '@/lib/data-core/manual-source-ops';

export const NAVY_LRAE_CONTRACT: ManualSourceContract = {
  sourceKey: 'navy_lrae',
  displayName: 'Navy LRAE forecast',
  actionType: 'identity_resolution',
  owner: 'eric',
  runbookPath: 'docs/runbooks/navy-lrae.md',
  // Navy publishes revisions irregularly; 90d is the observed outer bound, not a promise.
  expectedCadenceDays: 90,
};
