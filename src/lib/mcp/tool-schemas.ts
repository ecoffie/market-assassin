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

export interface McpRegistrationEntry {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
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
    return { name: fn.name, description: fn.description ?? '', inputSchema: shape as ZodRawShape };
  });
}
