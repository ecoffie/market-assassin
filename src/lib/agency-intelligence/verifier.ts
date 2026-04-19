// Perplexity Verification Layer
// Verifies agency intelligence data for accuracy before storage
// Uses Perplexity AI to cross-reference facts with current sources

import { AgencyIntelligence, PerplexityVerification } from './types';

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

interface VerificationResult {
  intelligence: AgencyIntelligence;
  verification: PerplexityVerification;
}

/**
 * Verify a single piece of agency intelligence using Perplexity
 */
export async function verifyIntelligence(
  intel: AgencyIntelligence
): Promise<VerificationResult> {
  if (!PERPLEXITY_API_KEY) {
    console.warn('[Verifier] No Perplexity API key configured');
    return {
      intelligence: intel,
      verification: {
        verified: false,
        confidence: 0,
        sources: [],
        notes: 'No API key configured for verification',
      },
    };
  }

  try {
    const prompt = buildVerificationPrompt(intel);

    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'system',
            content: `You are a fact-checking assistant specialized in federal government data.
Your job is to verify claims about federal agencies, their challenges, budgets, and programs.
Always cite your sources with URLs when possible.
Respond in JSON format: {"verified": boolean, "confidence": 0-100, "sources": ["url1", "url2"], "notes": "explanation"}`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON response
    const verification = parseVerificationResponse(content);

    return {
      intelligence: {
        ...intel,
        verified: verification.verified,
        verified_at: new Date().toISOString(),
        verification_source: 'perplexity',
        verification_notes: verification.notes,
      },
      verification,
    };
  } catch (error) {
    console.error('[Verifier] Error verifying intelligence:', error);
    return {
      intelligence: intel,
      verification: {
        verified: false,
        confidence: 0,
        sources: [],
        notes: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    };
  }
}

/**
 * Batch verify multiple intelligence items
 * Rate limited to avoid API throttling
 */
export async function batchVerify(
  items: AgencyIntelligence[],
  options: { concurrency?: number; delayMs?: number } = {}
): Promise<VerificationResult[]> {
  const { concurrency = 2, delayMs = 500 } = options;

  console.log(`[Verifier] Batch verifying ${items.length} items...`);

  const results: VerificationResult[] = [];

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(item => verifyIntelligence(item))
    );

    results.push(...batchResults);

    // Log progress
    const verified = results.filter(r => r.verification.verified).length;
    console.log(`[Verifier] Progress: ${results.length}/${items.length} (${verified} verified)`);

    // Rate limit delay
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  const verifiedCount = results.filter(r => r.verification.verified).length;
  console.log(`[Verifier] Complete: ${verifiedCount}/${items.length} verified (${((verifiedCount / items.length) * 100).toFixed(0)}%)`);

  return results;
}

/**
 * Quick verification without full Perplexity call
 * Uses source URL validation and date checking
 */
export function quickVerify(intel: AgencyIntelligence): boolean {
  // Has a source URL
  if (!intel.source_url) return false;

  // Source is from a known authoritative domain
  const authorativeDomains = [
    'gao.gov',
    'oversight.gov',
    'oig.gov',
    'usaspending.gov',
    'sam.gov',
    'govinfo.gov',
    'itdashboard.gov',
    'congress.gov',
  ];

  const hasAuthoritativeSource = authorativeDomains.some(domain =>
    intel.source_url?.includes(domain)
  );

  // Publication date is within 2 years
  const isRecent = intel.publication_date
    ? new Date(intel.publication_date) > new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
    : true;

  return hasAuthoritativeSource && isRecent;
}

// Helper functions

function buildVerificationPrompt(intel: AgencyIntelligence): string {
  return `Verify this federal government fact:

Agency: ${intel.agency_name}
Type: ${intel.intelligence_type}
Claim: "${intel.title}"
${intel.description ? `Details: ${intel.description}` : ''}
${intel.source_url ? `Cited Source: ${intel.source_url}` : ''}
${intel.fiscal_year ? `Fiscal Year: ${intel.fiscal_year}` : ''}

Is this claim accurate and current? Verify against official government sources.
Respond in JSON format: {"verified": boolean, "confidence": 0-100, "sources": ["url1"], "notes": "explanation"}`;
}

function parseVerificationResponse(content: string): PerplexityVerification {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        verified: Boolean(parsed.verified),
        confidence: Number(parsed.confidence) || 0,
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        notes: String(parsed.notes || ''),
      };
    }
  } catch {
    // Fall back to text parsing
  }

  // Default response if parsing fails
  return {
    verified: false,
    confidence: 0,
    sources: [],
    notes: `Unable to parse verification response: ${content.slice(0, 200)}`,
  };
}

export default {
  verifyIntelligence,
  batchVerify,
  quickVerify,
};
