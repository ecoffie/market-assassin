import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface AgencyIndex {
  agencies: Record<string, {
    file: string;
    aliases?: string[];
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agencyName: string }> }
) {
  try {
    const { agencyName } = await params;
    const decodedAgencyName = decodeURIComponent(agencyName);
    console.log(`Knowledge base request for: ${decodedAgencyName}`);

    // Load the agency index to find the right file
    const indexPath = path.join(process.cwd(), 'src', 'data', 'agencies', 'index.json');

    if (!fs.existsSync(indexPath)) {
      return NextResponse.json({
        success: false,
        message: 'Agency index not found.',
        agencyName: decodedAgencyName
      });
    }

    const indexData: AgencyIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    // Find the agency file by matching name or aliases
    let agencyFile: string | null = null;
    for (const [key, value] of Object.entries(indexData.agencies)) {
      // Check if the agency name matches the key
      if (key.toLowerCase() === decodedAgencyName.toLowerCase()) {
        agencyFile = value.file;
        break;
      }
      // Check if it matches any alias
      if (value.aliases && value.aliases.some(alias =>
        alias.toLowerCase() === decodedAgencyName.toLowerCase() ||
        decodedAgencyName.toLowerCase().includes(alias.toLowerCase())
      )) {
        agencyFile = value.file;
        break;
      }
    }

    if (!agencyFile) {
      console.log(`No knowledge base file found for: ${decodedAgencyName}`);
      return NextResponse.json({
        success: false,
        message: 'No knowledge base data available for this agency yet.',
        agencyName: decodedAgencyName
      });
    }

    // Load the agency data
    const agencyPath = path.join(process.cwd(), 'src', 'data', 'agencies', agencyFile);

    if (!fs.existsSync(agencyPath)) {
      return NextResponse.json({
        success: false,
        message: 'Agency data file not found.',
        agencyName: decodedAgencyName
      });
    }

    const agencyData = JSON.parse(fs.readFileSync(agencyPath, 'utf8'));

    console.log(`Found knowledge base for ${agencyData.name} (${agencyData.abbreviation})`);

    // Return the agency data
    return NextResponse.json({
      success: true,
      data: agencyData
    });

  } catch (error) {
    console.error('Error loading agency knowledge base:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load agency knowledge base',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
