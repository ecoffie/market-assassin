/**
 * Links into the "Mindy in your AI" gallery (/mcp/gallery). No example data here, so the pricing
 * page can link to examples without bundling the gallery.
 */
/** Opens one example on the gallery (Gallery.tsx reads `?example=` on load). */
export const GALLERY_EXAMPLE_PARAM = 'example';

export function galleryExampleHref(id: string): string {
  return `/mcp/gallery?${GALLERY_EXAMPLE_PARAM}=${encodeURIComponent(id)}`;
}

/**
 * The pricing calculator's activities (UnifiedPricing TASKS ids) -> the gallery example that shows
 * that work finished. Only genuine matches: an activity with no fitting example is left out, and
 * gallery.unit.test.ts fails if an id here stops existing in GALLERY_ITEMS.
 */
export const PRICING_TASK_EXAMPLES: Readonly<Record<string, string>> = {
  find: 'where-the-money-is',
  incumbent: 'who-holds-it',
  price: 'labor-rates',
  playbook: 'capture-plan',
  teaming: 'teaming-partners',
  proposal: 'proposal-draft',
};
