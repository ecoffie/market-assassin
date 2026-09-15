/**
 * MCP tool: get_current_acquisition_intelligence — CURRENT INTELLIGENCE journey slot.
 *
 * Credits: 8 (composed LIVE read). Facts are deterministic; no LLM narration.
 */
import {
  getCurrentAcquisitionIntelligence,
  type CurrentAcquisitionIntelligenceInput,
  type CurrentAcquisitionIntelligenceResult,
} from '@/lib/opportunities/current-acquisition-intelligence';

export type { CurrentAcquisitionIntelligenceInput, CurrentAcquisitionIntelligenceResult };

export async function currentAcquisitionIntelligenceTool(
  input: CurrentAcquisitionIntelligenceInput,
): Promise<CurrentAcquisitionIntelligenceResult> {
  return getCurrentAcquisitionIntelligence(input);
}
