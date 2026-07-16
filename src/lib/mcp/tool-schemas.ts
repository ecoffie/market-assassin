/**
 * Bridge the registry's OpenAI-style JSON-Schema tool defs (listMcpTools) into
 * the Zod input shapes the MCP SDK's `server.registerTool` wants — so the hosted
 * HTTP transport can register EVERY registry tool from one source of truth
 * instead of hand-declaring one. This is what keeps the endpoint's advertised
 * toolset in sync with `runMcpTool` / the `/mcp` pricing table (they had drifted:
 * the registry has 9 tools, the transport only exposed get_winning_playbook).
 *
 * The registry's parameter schemas are deliberately simple (string / number /
 * boolean / array / enum / object), so a small converter covers them; anything
 * unrecognized falls back to a permissive `z.unknown()` rather than a restrictive
 * default, so a schema quirk can never block an otherwise-valid tool call.
 */
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { listMcpTools } from './tool-registry';

interface JsonSchemaProp {
  type?: string;
  description?: string;
  items?: { type?: string };
  enum?: string[];
}
interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

function scalar(type: string | undefined): ZodTypeAny {
  switch (type) {
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'string':
      return z.string();
    default:
      return z.unknown();
  }
}

function propToZod(prop: JsonSchemaProp): ZodTypeAny {
  let base: ZodTypeAny;
  if (prop.enum && prop.enum.length) {
    base = z.enum(prop.enum as [string, ...string[]]);
  } else if (prop.type === 'array') {
    base = z.array(scalar(prop.items?.type));
  } else {
    base = scalar(prop.type);
  }
  return prop.description ? base.describe(prop.description) : base;
}

/**
 * MCP tool annotations (the SDK's `ToolAnnotations`). Claude Desktop reads these
 * to BUCKET tools in its "Tool permissions" UI — without them every tool lands in
 * one flat "Other tools" pile (readOnlyHint absent → uncategorizable). Every Mindy
 * MCP tool is a read-only intel/compute lookup: it queries gov/proprietary data or
 * computes over a solicitation and returns it — it never mutates the user's Mindy
 * account or any external system. So they all carry readOnlyHint:true and collapse
 * into a single "Read-only tools — Always allow" bucket (one safe toggle).
 *
 * ⚠️ If a MUTATING tool is ever added (writes to the user's account, sends an email,
 * etc.), it MUST override this with `readOnlyHint:false, destructiveHint:true` so it
 * does NOT hide inside the always-allow read-only group.
 */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const READ_ONLY_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,   // → Claude Desktop "Read-only tools" bucket
  idempotentHint: true, // same args → same data (a query, not a mutation)
  openWorldHint: true,  // hits live external data (SAM / USASpending / EDGAR / corpus)
};

export interface McpRegistrationEntry {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: McpToolAnnotations;
}

/**
 * Every MCP tool as { name, description, Zod input shape } — ready to loop into
 * `server.registerTool`. Derived from `listMcpTools()`, so adding a tool to the
 * registry automatically surfaces it on the transport.
 */
export function mcpRegistrationList(): McpRegistrationEntry[] {
  return listMcpTools().map((raw) => {
    const fn = (raw as { function: { name: string; description?: string; parameters?: JsonSchema } }).function;
    const params = fn.parameters ?? { type: 'object', properties: {} };
    const required = new Set(params.required ?? []);
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(params.properties ?? {})) {
      const zod = propToZod(prop);
      shape[key] = required.has(key) ? zod : zod.optional();
    }
    return {
      name: fn.name,
      description: fn.description ?? '',
      inputSchema: shape as ZodRawShape,
      annotations: READ_ONLY_ANNOTATIONS,
    };
  });
}
