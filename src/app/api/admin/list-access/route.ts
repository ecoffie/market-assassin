import { NextResponse } from 'next/server';
import { getAllMarketAssassinAccess, getAllContentGeneratorAccess, getAllRecompeteAccess, getAllDatabaseAccess } from '@/lib/access-codes';
import { kv } from '@vercel/kv';

// Admin endpoint to list all access records
export async function GET() {
  try {
    // Get Market Assassin records
    const marketAssassin = await getAllMarketAssassinAccess();

    // Get Opportunity Hunter Pro records
    const osProEmails = await kv.lrange('ospro:all', 0, -1) as string[];
    const opportunityScoutPro = [];

    if (osProEmails && osProEmails.length > 0) {
      for (const email of osProEmails) {
        const access = await kv.get(`ospro:${email}`);
        if (access) {
          opportunityScoutPro.push(access);
        }
      }
    }

    // Get Content Generator records
    const contentGenerator = await getAllContentGeneratorAccess();

    // Get Recompete records
    const recompete = await getAllRecompeteAccess();

    // Get Database records
    const database = await getAllDatabaseAccess();

    return NextResponse.json({
      marketAssassin,
      opportunityScoutPro,
      contentGenerator,
      recompete,
      database,
    });

  } catch (error) {
    console.error('Error listing access records:', error);
    return NextResponse.json(
      { error: 'Failed to list access records' },
      { status: 500 }
    );
  }
}
