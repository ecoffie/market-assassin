/**
 * Ask Mindy tool: the national-lab supplier directory (static, official sources). Chat-only for now — exposing it on
 * the public MCP catalog is a catalog change, deferred.
 */
import { labDirectoryAnswer } from '@/lib/labs/lab-directory';

export const LAB_SUPPLIER_INFO = 'get_lab_supplier_info';

export const LAB_SUPPLIER_INFO_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: LAB_SUPPLIER_INFO,
    description:
      'How a small business sells to a DOE national laboratory (Sandia, Los Alamos, Oak Ridge, Argonne, …): the operator (M&O contractor), supplier portal and registration system, small-business goal and office, and published buying rules — each with its official source URL. Call it for "how do I sell to Sandia / the national labs / an FFRDC". Fields a lab does not publish come back "not published": say so, never fill them in. Always state the coverage line.',
    parameters: {
      type: 'object',
      properties: {
        lab: { type: 'string', description: 'Lab name or short name (e.g. "Sandia", "ORNL"). Omit for the whole directory.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export function makeLabDirectoryTool() {
  return {
    async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const lab = typeof args?.lab === 'string' ? args.lab.slice(0, 120) : null;
      return labDirectoryAnswer(lab);
    },
  };
}
