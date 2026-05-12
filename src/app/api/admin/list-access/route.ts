import { NextRequest, NextResponse } from 'next/server';
import { getAllMarketAssassinAccess, getAllContentGeneratorAccess, getAllRecompeteAccess, getAllDatabaseAccess } from '@/lib/access-codes';
import { kv } from '@vercel/kv';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

async function safeSection<T>(label: string, getter: () => Promise<T>, fallback: T): Promise<{ data: T; warning?: string }> {
  try {
    return { data: await getter() };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    console.warn(`[Admin List Access] ${label} unavailable`, error);
    return { data: fallback, warning };
  }
}

// Admin endpoint to list all access records
export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  const password = request.headers.get('x-admin-password');
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    // Get Market Assassin records
    const marketAssassin = await safeSection('Market Assassin records', getAllMarketAssassinAccess, []);

    // Get Opportunity Hunter Pro records
    const opportunityScoutPro = await safeSection('Opportunity Hunter Pro records', async () => {
      const osProEmails = await kv.lrange('ospro:all', 0, -1) as string[];
      const records = [];

      if (osProEmails && osProEmails.length > 0) {
        for (const email of osProEmails) {
          const access = await kv.get(`ospro:${email}`);
          if (access) {
            records.push(access);
          }
        }
      }

      return records;
    }, []);

    // Get Content Reaper records
    const contentGenerator = await safeSection('Content Reaper records', getAllContentGeneratorAccess, []);

    // Get Recompete records
    const recompete = await safeSection('Recompete records', getAllRecompeteAccess, []);

    // Get Database records
    const database = await safeSection('Database records', getAllDatabaseAccess, []);

    const warnings = [
      marketAssassin.warning && `marketAssassin: ${marketAssassin.warning}`,
      opportunityScoutPro.warning && `opportunityScoutPro: ${opportunityScoutPro.warning}`,
      contentGenerator.warning && `contentGenerator: ${contentGenerator.warning}`,
      recompete.warning && `recompete: ${recompete.warning}`,
      database.warning && `database: ${database.warning}`,
    ].filter(Boolean);

    return NextResponse.json({
      marketAssassin: marketAssassin.data,
      opportunityScoutPro: opportunityScoutPro.data,
      contentGenerator: contentGenerator.data,
      recompete: recompete.data,
      database: database.data,
      warnings,
    });

  } catch (error) {
    console.error('Error listing access records:', error);
    return NextResponse.json(
      { error: 'Failed to list access records' },
      { status: 500 }
    );
  }
}
