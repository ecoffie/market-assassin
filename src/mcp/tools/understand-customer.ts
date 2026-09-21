/**
 * MCP tool: understand_customer — Customer Journey UNDERSTAND transition.
 *
 * After specific FIND: "what this customer cares about and what you should say."
 * Returns the three-part package (opportunity says / agency research / emphasize).
 * Credits: 5. POSITION/ACT outputs not included yet.
 */
import {
  understandCustomer,
  type UnderstandCustomerInput,
  type UnderstandCustomerResult,
} from '@/lib/opportunities/understand-customer';

export type { UnderstandCustomerInput, UnderstandCustomerResult };

export async function understandCustomerTool(
  input: UnderstandCustomerInput,
): Promise<UnderstandCustomerResult> {
  return understandCustomer(input);
}
