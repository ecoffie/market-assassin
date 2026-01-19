/**
 * REPORTS DISPLAY COMPONENT
 * =========================
 *
 * CRITICAL: This component displays the 8 strategic reports.
 * DO NOT REMOVE OR MODIFY WITHOUT TESTING.
 *
 * REPORTS DISPLAYED:
 * 1. Executive Summary (summary tab)
 * 2. Market Analytics (spending, trends, geographic charts)
 * 3. Government Buyers (contacts at agencies)
 * 4. Subcontracting Opportunities (prime contractors)
 * 5. IDV Contracts (BPAs, IDIQs, GWACs)
 * 6. Similar Awards (past contracts in NAICS)
 * 7. Tribal Contracting (tribal partnerships)
 * 8. OSBP Contacts (small business offices)
 *
 * REQUIRED PROPS:
 * - reports: ComprehensiveReport - all report data
 * - onReset: () => void - callback to start over
 *
 * FEATURES:
 * - Tab navigation between reports
 * - Export to PDF/HTML/JSON
 * - Charts for spending analysis
 * - Pain points modal for agencies
 *
 * Last working version: 2026-01-07
 */

'use client';

import { ComprehensiveReport, CoreInputs } from '@/types/federal-market-assassin';
import { useState, useEffect, useCallback } from 'react';
import {
  AgencySpendingChart,
  SpendingTrendChart,
  GeographicDistributionChart,
} from '../charts';
import {
  getHitListByCoreInputs,
  getCombinedHitList,
  getDaysUntilDeadline,
  getUrgencyBadge,
  getHitListActionStrategy,
  getHitListStats,
  HitListOpportunity,
} from '@/lib/utils/december-hit-list';

import { MarketAssassinTier, MARKET_ASSASSIN_TIER_FEATURES } from '@/lib/access-codes';

interface ReportsDisplayProps {
  reports: ComprehensiveReport;
  onReset: () => void;
  tier?: MarketAssassinTier;
  onUpgrade?: () => void;
}

interface AgencyForModal {
  name: string;
  contractingOffice?: string;
  subAgency?: string;
  parentAgency?: string;
  spending?: number;
  contractCount?: number;
  location?: string;
  officeId?: string;
  command?: string | null;
}

interface CategorizedPainPoints {
  [category: string]: string[];
}

interface PainPointsApiResponse {
  success: boolean;
  agency: string;
  painPoints: string[];
  categorized: CategorizedPainPoints;
  ndaaPainPoints: string[];
  count: number;
}

type ReportTab =
  | 'analytics'
  | 'buyers'
  | 'subcontracting'
  | 'idvContracts'
  | 'osbpContacts'
  | 'december'
  | 'tribal';

// Helper function to format currency values intelligently
function formatCurrency(value: number): string {
  if (value >= 1000000000) {
    // Billions
    return `$${(value / 1000000000).toFixed(1)}B`;
  } else if (value >= 1000000) {
    // Millions
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    // Thousands
    return `$${(value / 1000).toFixed(1)}K`;
  } else {
    // Less than 1000
    return `$${value.toFixed(0)}`;
  }
}

// Helper to format Office ID for display
// For DOD expanded agencies, officeId might be "department-of-defense|Dept...|...-USACE"
// We want to show just the command abbreviation (e.g., "USACE") or the numeric ID
function formatOfficeId(rawOfficeId: string | undefined, command?: string | null): string {
  if (!rawOfficeId) return 'N/A';

  // If it's a simple numeric ID, return as-is
  if (/^\d+$/.test(rawOfficeId)) {
    return rawOfficeId;
  }

  // If it contains path separators, extract the command abbreviation
  if (rawOfficeId.includes('|') || rawOfficeId.includes('-')) {
    // Try to extract command abbreviation from the end (e.g., "...-USACE" -> "USACE")
    const parts = rawOfficeId.split(/[-|]/);
    const lastPart = parts[parts.length - 1];
    // Use the command abbreviation if it looks like one (all caps, short)
    if (lastPart && lastPart.length <= 10 && /^[A-Z0-9]+$/.test(lastPart)) {
      return lastPart;
    } else if (command) {
      // Fall back to using the command field directly
      return command;
    }
  }

  // Fall back to command if provided
  if (command) {
    return command;
  }

  return rawOfficeId;
}

export default function ReportsDisplay({ reports, onReset, tier = 'premium', onUpgrade }: ReportsDisplayProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>('analytics');
  const [showAllForExport, setShowAllForExport] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Modal state
  const [modalAgency, setModalAgency] = useState<AgencyForModal | null>(null);
  const [painPointsData, setPainPointsData] = useState<PainPointsApiResponse | null>(null);
  const [loadingPainPoints, setLoadingPainPoints] = useState(false);
  const [matchedCommand, setMatchedCommand] = useState<string | null>(null);
  const [additionalCommands, setAdditionalCommands] = useState<Array<{command: string, painPoints: PainPointsApiResponse}>>([]);

  // Premium sections that are blocked for standard tier
  const premiumSections: ReportTab[] = ['idvContracts', 'december', 'subcontracting', 'tribal'];
  const isSectionLocked = (tabId: ReportTab) => tier === 'standard' && premiumSections.includes(tabId);

  // Helper to extract DoD command abbreviations from agency names
  // Maps to exact database keys for pain points lookup
  const extractDoDCommands = (name: string): string[] => {
    const commands: string[] = [];
    const text = name.toUpperCase();

    // Navy commands (exact database keys)
    if (text.includes('NAVFAC') || text.includes('NAVAL FACILITIES')) commands.push('NAVFAC');
    if (text.includes('NAVSEA') || text.includes('NAVAL SEA SYSTEMS')) commands.push('NAVSEA');
    if (text.includes('NAVAIR') || text.includes('NAVAL AIR SYSTEMS')) commands.push('NAVAIR');
    if (text.includes('NAVWAR') || text.includes('SPAWAR') || text.includes('INFORMATION WARFARE')) commands.push('NAVWAR');
    if (text.includes('MARINE CORPS SYSTEMS')) commands.push('Marine Corps Systems Command');

    // Army commands (exact database keys)
    if (text.includes('USACE') || text.includes('CORPS OF ENGINEERS') || text.includes('ARMY CORPS')) commands.push('USACE');
    if (text.includes('ARMY CONTRACTING COMMAND') || (text.includes('ACC') && text.includes('ARMY'))) commands.push('Army Contracting Command');
    if (text.includes('ARMY MATERIEL COMMAND') || (text.includes('AMC') && text.includes('ARMY'))) commands.push('Army Materiel Command');

    // Air Force commands (exact database keys)
    if (text.includes('AIR FORCE MATERIEL') || text.includes('AFLCMC') || text.includes('LIFE CYCLE')) commands.push('Air Force Materiel Command');
    if (text.includes('AIR FORCE SUSTAINMENT') || text.includes('AFSC')) commands.push('Air Force Sustainment Center');
    if (text.includes('SPACE SYSTEMS COMMAND') || text.includes('SSC')) commands.push('Space Systems Command');

    // Defense agencies (exact database keys)
    if (text.includes('DISA') || text.includes('DEFENSE INFORMATION SYSTEMS')) commands.push('Defense Information Systems Agency');
    if (text.includes('DLA') || text.includes('DEFENSE LOGISTICS')) commands.push('Defense Logistics Agency');
    if (text.includes('DARPA') || text.includes('ADVANCED RESEARCH PROJECTS')) commands.push('DARPA');
    if (text.includes('MDA') || text.includes('MISSILE DEFENSE')) commands.push('Missile Defense Agency');
    if (text.includes('DCMA') || text.includes('DEFENSE CONTRACT MANAGEMENT')) commands.push('Defense Contract Management Agency');
    if (text.includes('DCAA') || text.includes('DEFENSE CONTRACT AUDIT')) commands.push('Defense Contract Audit Agency');
    if (text.includes('DHA') || text.includes('DEFENSE HEALTH')) commands.push('Defense Health Agency');

    return commands;
  };

  // Get all sub-commands for a parent agency
  const getSubCommandsForParent = (parentName: string): string[] => {
    const name = parentName.toUpperCase();
    if (name.includes('NAVY')) {
      return ['NAVSEA', 'NAVFAC', 'NAVAIR', 'NAVWAR', 'Marine Corps Systems Command'];
    }
    if (name.includes('ARMY')) {
      return ['USACE', 'Army Contracting Command', 'Army Materiel Command'];
    }
    if (name.includes('AIR FORCE')) {
      return ['Air Force Materiel Command', 'Air Force Sustainment Center', 'Space Systems Command'];
    }
    if (name.includes('DEFENSE') && !name.includes('DEPARTMENT')) {
      return ['Defense Logistics Agency', 'Defense Information Systems Agency', 'DARPA', 'Missile Defense Agency', 'Defense Health Agency'];
    }
    return [];
  };

  // Modal functions
  const openAgencyModal = useCallback(async (agency: AgencyForModal) => {
    setModalAgency(agency);
    setPainPointsData(null);
    setMatchedCommand(null);
    setAdditionalCommands([]);
    setLoadingPainPoints(true);

    try {
      // Build comprehensive search strategies
      const allTexts = [agency.name, agency.contractingOffice, agency.subAgency].filter(Boolean).join(' ');
      const extractedCommands = extractDoDCommands(allTexts);

      // First, try to find pain points for ALL extracted commands
      const commandResults: Array<{command: string, painPoints: PainPointsApiResponse}> = [];

      for (const command of extractedCommands) {
        try {
          const response = await fetch(`/api/pain-points?agency=${encodeURIComponent(command)}`);
          const data = await response.json();
          if (data.success && data.painPoints && data.painPoints.length > 0) {
            commandResults.push({ command, painPoints: data });
          }
        } catch (e) {
          console.error(`Error fetching pain points for ${command}:`, e);
        }
      }

      // If we found command-specific results, use those
      if (commandResults.length > 0) {
        setPainPointsData(commandResults[0].painPoints);
        setMatchedCommand(commandResults[0].command);
        setAdditionalCommands(commandResults.slice(1));
      } else {
        // No specific commands found - check if this is a parent agency
        // If so, fetch ALL sub-commands for that service branch
        const subCommands = getSubCommandsForParent(agency.name) ||
                          getSubCommandsForParent(agency.subAgency || '') ||
                          getSubCommandsForParent(agency.parentAgency || '');

        if (subCommands.length > 0) {
          // Fetch pain points for all sub-commands
          for (const command of subCommands) {
            try {
              const response = await fetch(`/api/pain-points?agency=${encodeURIComponent(command)}`);
              const data = await response.json();
              if (data.success && data.painPoints && data.painPoints.length > 0) {
                commandResults.push({ command, painPoints: data });
              }
            } catch (e) {
              console.error(`Error fetching pain points for ${command}:`, e);
            }
          }

          if (commandResults.length > 0) {
            setPainPointsData(commandResults[0].painPoints);
            setMatchedCommand(commandResults[0].command);
            setAdditionalCommands(commandResults.slice(1));
          }
        }

        // If still nothing, try the parent agency directly
        if (commandResults.length === 0) {
          const fallbackStrategies = [
            agency.subAgency,
            agency.parentAgency,
            agency.parentAgency?.replace('Department of the ', '').replace('Department of ', ''),
          ].filter(Boolean);

          for (const searchName of fallbackStrategies) {
            if (!searchName) continue;
            const response = await fetch(`/api/pain-points?agency=${encodeURIComponent(searchName)}`);
            const data = await response.json();
            if (data.success && data.painPoints && data.painPoints.length > 0) {
              setPainPointsData(data);
              setMatchedCommand(searchName);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading pain points:', error);
    } finally {
      setLoadingPainPoints(false);
    }
  }, []);

  const closeAgencyModal = useCallback(() => {
    setModalAgency(null);
    setPainPointsData(null);
    setMatchedCommand(null);
    setAdditionalCommands([]);
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalAgency) {
        closeAgencyModal();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [modalAgency, closeAgencyModal]);

  const getSamSearchUrl = (agencyName: string) => {
    const encoded = encodeURIComponent(agencyName);
    return `https://sam.gov/search/?index=opp&page=1&pageSize=25&sort=-modifiedDate&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&q=${encoded}`;
  };

  const tabs = [
    { id: 'analytics' as ReportTab, label: '📈 Analytics', icon: '📈' },
    { id: 'buyers' as ReportTab, label: '👥 Government Buyers', icon: '👥' },
    { id: 'osbpContacts' as ReportTab, label: '📞 OSBP Contacts', icon: '📞' },
    { id: 'subcontracting' as ReportTab, label: '🔗 Subcontracting', icon: '🔗' },
    { id: 'idvContracts' as ReportTab, label: '📋 IDV Contracts', icon: '📋' },
    { id: 'december' as ReportTab, label: '📊 Similar Awards', icon: '📊' },
    { id: 'tribal' as ReportTab, label: '🏛️ Tribal Contracting', icon: '🏛️' },
  ];

  const handleExportPDF = () => {
    // Show all reports for printing
    setShowAllForExport(true);
    // Use setTimeout to allow React to render all reports before printing
    setTimeout(() => {
      window.print();
      // Reset back to tabbed view after print dialog closes
      setTimeout(() => {
        setShowAllForExport(false);
      }, 1000);
    }, 100);
  };

  // Export all data as CSV files (zipped)
  const [exportingCSV, setExportingCSV] = useState(false);

  const handleExportCSV = async () => {
    setExportingCSV(true);
    const date = new Date().toISOString().split('T')[0];

    // Helper to escape CSV values
    const escapeCSV = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Helper to create CSV content
    const createCSV = (headers: string[], rows: any[][]) => {
      const headerRow = headers.map(escapeCSV).join(',');
      const dataRows = rows.map(row => row.map(escapeCSV).join(','));
      return [headerRow, ...dataRows].join('\n');
    };

    // 1. Government Buyers CSV
    const buyersHeaders = ['Rank', 'Agency', 'Parent Agency', 'Spending', 'Contract Count', 'OSBP Contact', 'OSBP Email', 'OSBP Phone'];
    const buyersRows = reports.governmentBuyers.agencies.map((agency: any, i: number) => [
      i + 1,
      agency.contractingOffice || agency.name,
      agency.parentAgency || agency.subAgency || '',
      agency.spending ? `$${(agency.spending / 1000000).toFixed(2)}M` : '',
      agency.contractCount || '',
      agency.osbp?.name || '',
      agency.osbp?.email || '',
      agency.osbp?.phone || ''
    ]);
    const buyersCSV = createCSV(buyersHeaders, buyersRows);

    // 2. OSBP Contacts CSV
    const osbpMap = new Map();
    reports.governmentBuyers.agencies.forEach((agency: any) => {
      if (agency.osbp?.email) {
        const key = agency.osbp.email;
        if (!osbpMap.has(key)) {
          osbpMap.set(key, { ...agency.osbp, agencies: [agency.contractingOffice || agency.name] });
        } else {
          osbpMap.get(key).agencies.push(agency.contractingOffice || agency.name);
        }
      }
    });
    const osbpHeaders = ['Name', 'Email', 'Phone', 'Website', 'Agencies Covered'];
    const osbpRows = Array.from(osbpMap.values()).map((contact: any) => [
      contact.name || '',
      contact.email || '',
      contact.phone || '',
      contact.website || '',
      contact.agencies.join('; ')
    ]);
    const osbpCSV = createCSV(osbpHeaders, osbpRows);

    // 3. Agency Pain Points & Priorities CSV - Fetch for all agencies
    const painPointsRows: any[][] = [];
    const uniqueAgencies = new Set<string>();

    // Collect unique agencies/commands to fetch pain points for
    for (const agency of reports.governmentBuyers.agencies) {
      const allTexts = [agency.contractingOffice, agency.subAgency, agency.parentAgency].filter(Boolean).join(' ');
      const commands = extractDoDCommands(allTexts);
      commands.forEach(cmd => uniqueAgencies.add(cmd));

      // Also add parent agency for civilian agencies
      if (agency.parentAgency) {
        uniqueAgencies.add(agency.parentAgency);
        uniqueAgencies.add(agency.parentAgency.replace('Department of the ', '').replace('Department of ', ''));
      }
      if (agency.subAgency) {
        uniqueAgencies.add(agency.subAgency);
      }
    }

    // Fetch pain points for each unique agency/command
    const fetchedAgencies = new Set<string>();
    for (const agencyName of uniqueAgencies) {
      if (fetchedAgencies.has(agencyName)) continue;

      try {
        const response = await fetch(`/api/pain-points?agency=${encodeURIComponent(agencyName)}`);
        const data = await response.json();

        if (data.success && data.painPoints && data.painPoints.length > 0) {
          fetchedAgencies.add(agencyName);

          // Add categorized pain points
          if (data.categorized && Object.keys(data.categorized).length > 0) {
            for (const [category, points] of Object.entries(data.categorized)) {
              for (const point of (points as string[])) {
                painPointsRows.push([
                  data.agency || agencyName,
                  category,
                  point,
                  'Strategic Priority'
                ]);
              }
            }
          } else {
            // Add uncategorized pain points
            for (const point of data.painPoints) {
              painPointsRows.push([
                data.agency || agencyName,
                'General',
                point,
                'Priority'
              ]);
            }
          }

          // Add NDAA pain points if available
          if (data.ndaaPainPoints && data.ndaaPainPoints.length > 0) {
            for (const point of data.ndaaPainPoints) {
              painPointsRows.push([
                data.agency || agencyName,
                'NDAA/Legislative',
                point,
                'Legislative Mandate'
              ]);
            }
          }
        }
      } catch (e) {
        console.error(`Error fetching pain points for ${agencyName}:`, e);
      }
    }

    const painPointsHeaders = ['Agency/Command', 'Category', 'Pain Point / Priority', 'Type'];
    const painPointsCSV = createCSV(painPointsHeaders, painPointsRows);

    // Premium-only CSVs
    let subcontractingCSV = '';
    let idvCSV = '';
    let similarAwardsCSV = '';
    let tribalCSV = '';

    if (tier === 'premium') {
      // 4. Subcontracting Opportunities CSV
      const subHeaders = ['Company Name', 'Contract Value', 'Contract Count', 'SBLO Contact', 'Phone', 'Email', 'Has Subcontract Plan', 'Supplier Portal', 'Agencies', 'NAICS Codes'];
      const allPrimes = [...(reports.tier2Subcontracting?.suggestedPrimes || []), ...(reports.primeContractor?.suggestedPrimes || [])];
      const subRows = allPrimes.map((prime: any) => [
        prime.name || '',
        prime.totalContractValue ? `$${(prime.totalContractValue / 1000000).toFixed(2)}M` : '',
        prime.contractCount || '',
        prime.sbloName || '',
        prime.phone || '',
        prime.email || '',
        prime.hasSubcontractPlan ? 'Yes' : 'No',
        prime.supplierPortal || '',
        (prime.relevantAgencies || []).join('; '),
        (prime.naicsCategories || []).join('; ')
      ]);
      subcontractingCSV = createCSV(subHeaders, subRows);

      // 5. IDV Contracts CSV
      const idvHeaders = ['Contract Name', 'Agency', 'Value', 'Type', 'Set-Aside'];
      const idvRows = (reports.idvContracts?.contracts || []).map((contract: any) => [
        contract.name || contract.title || '',
        contract.agency || '',
        contract.value ? `$${(contract.value / 1000000).toFixed(2)}M` : '',
        contract.type || '',
        contract.setAside || ''
      ]);
      idvCSV = createCSV(idvHeaders, idvRows);

      // 6. Similar Awards CSV
      const awardsHeaders = ['Agency', 'Program/Description', 'Award Value', 'Relevance Level'];
      const awardsRows = (reports.decemberSpend?.opportunities || []).map((opp: any) => [
        opp.agency || '',
        opp.program || '',
        opp.estimatedQ4Spend ? `$${(opp.estimatedQ4Spend / 1000000).toFixed(2)}M` : '',
        opp.urgencyLevel || ''
      ]);
      similarAwardsCSV = createCSV(awardsHeaders, awardsRows);

      // 7. Tribal Contracting CSV
      const tribalHeaders = ['Business Name', 'Region', 'Capabilities', 'Certifications', 'NAICS Codes', 'Contact Name', 'Contact Email', 'Contact Phone'];
      const tribalRows = (reports.tribalContracting?.suggestedTribes || []).map((tribe: any) => [
        tribe.name || '',
        tribe.region || '',
        (tribe.capabilities || []).join('; '),
        (tribe.certifications || []).join('; '),
        (tribe.naicsCategories || []).join('; '),
        tribe.contactInfo?.name || '',
        tribe.contactInfo?.email || '',
        tribe.contactInfo?.phone || ''
      ]);
      tribalCSV = createCSV(tribalHeaders, tribalRows);
    }

    // Create and download each CSV
    const downloadCSV = (content: string, filename: string) => {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    };

    // Download all CSVs with slight delays to prevent browser blocking
    downloadCSV(buyersCSV, `government-buyers-${date}.csv`);
    setTimeout(() => downloadCSV(osbpCSV, `osbp-contacts-${date}.csv`), 100);

    // Pain points CSV for all tiers (if we found any)
    if (painPointsRows.length > 0) {
      setTimeout(() => downloadCSV(painPointsCSV, `agency-pain-points-priorities-${date}.csv`), 200);
    }

    if (tier === 'premium') {
      setTimeout(() => downloadCSV(subcontractingCSV, `subcontracting-opportunities-${date}.csv`), 300);
      setTimeout(() => downloadCSV(idvCSV, `idv-contracts-${date}.csv`), 400);
      setTimeout(() => downloadCSV(similarAwardsCSV, `similar-awards-${date}.csv`), 500);
      setTimeout(() => downloadCSV(tribalCSV, `tribal-contracting-${date}.csv`), 600);
    }

    setExportingCSV(false);
  };

  // Export all reports as a single HTML file that can be saved/printed
  const handleExportHTML = () => {
    const date = new Date().toLocaleDateString();
    const inputs = reports.metadata.inputs;

    // Build HTML content for all reports
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Federal Market Assassin - Comprehensive Report - ${date} | GovCon Giants</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .brand { text-align: center; margin-bottom: 20px; }
    .brand-govcon { font-size: 28px; font-weight: 700; color: #1d4ed8; }
    .brand-giants { font-size: 28px; font-weight: 700; color: #f59e0b; }
    h1 { color: #1e40af; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; }
    h2 { color: #1e3a8a; margin-top: 40px; border-bottom: 2px solid #93c5fd; padding-bottom: 8px; page-break-before: always; }
    h2:first-of-type { page-break-before: avoid; }
    h3 { color: #1e40af; margin-top: 20px; }
    .meta { background: #f1f5f9; padding: 15px; border-radius: 8px; margin-bottom: 30px; }
    .meta-item { display: inline-block; background: #e2e8f0; padding: 5px 12px; border-radius: 20px; margin: 3px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; }
    tr:hover { background: #f8fafc; }
    .amount { font-weight: 600; color: #059669; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 10px 0; }
    .card-title { font-weight: 600; color: #1e3a8a; margin-bottom: 8px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-purple { background: #f3e8ff; color: #7c3aed; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
    .stat-card { background: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1e40af; }
    .stat-label { font-size: 12px; color: #64748b; margin-top: 5px; }
    @media print { h2 { page-break-before: always; } h2:first-of-type { page-break-before: avoid; } .no-print { display: none; } }
    .section-intro { background: #eff6ff; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3b82f6; }
  </style>
</head>
<body>
  <div class="brand">
    <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
  </div>
  <h1>🎯 Federal Market Assassin - Comprehensive Report</h1>

  <div class="meta">
    <p><strong>Generated:</strong> ${date}</p>
    <p><strong>Search Criteria:</strong></p>
    <div>
      ${inputs.businessType ? `<span class="meta-item">📋 ${inputs.businessType}</span>` : ''}
      ${inputs.naicsCode ? `<span class="meta-item">🔢 NAICS: ${inputs.naicsCode}</span>` : ''}
      ${inputs.pscCode ? `<span class="meta-item">🏷️ PSC: ${inputs.pscCode}</span>` : ''}
      ${inputs.zipCode ? `<span class="meta-item">📍 ZIP: ${inputs.zipCode}</span>` : ''}
      ${inputs.veteranStatus && inputs.veteranStatus !== 'Not Applicable' ? `<span class="meta-item">🎖️ ${inputs.veteranStatus}</span>` : ''}
      ${inputs.companyName ? `<span class="meta-item">🏢 ${inputs.companyName}</span>` : ''}
    </div>
    <p><strong>Agencies Analyzed:</strong> ${reports.metadata.selectedAgencies.length}</p>
  </div>

  <!-- Government Buyers Report -->
  <h2>👥 Government Buyers Report</h2>
  <div class="section-intro">Top government agencies matching your criteria, ranked by spending in your NAICS code.</div>
  <table>
    <thead>
      <tr><th>Rank</th><th>Agency / Office</th><th>Parent Agency</th><th>Spending</th><th>Contracts</th></tr>
    </thead>
    <tbody>
      ${reports.governmentBuyers.agencies.slice(0, 50).map((agency: any, i: number) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${agency.contractingOffice || agency.name}</strong></td>
          <td>${agency.parentAgency || agency.subAgency || '-'}</td>
          <td class="amount">$${(agency.spending / 1000000).toFixed(2)}M</td>
          <td>${agency.contractCount || '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <!-- OSBP Contacts Report -->
  <h2>📞 OSBP Contacts</h2>
  <div class="section-intro">Small Business Office contacts for the agencies in your report.</div>
  ${(() => {
    const osbpMap = new Map();
    reports.governmentBuyers.agencies.forEach((agency: any) => {
      if (agency.osbp?.email) {
        const key = agency.osbp.email;
        if (!osbpMap.has(key)) {
          osbpMap.set(key, {
            ...agency.osbp,
            agencies: [agency.contractingOffice || agency.name],
            subAgency: agency.subAgency || agency.parentAgency
          });
        } else {
          osbpMap.get(key).agencies.push(agency.contractingOffice || agency.name);
        }
      }
    });
    const contacts = Array.from(osbpMap.values());
    if (contacts.length === 0) {
      return '<p style="color: #64748b; text-align: center; padding: 20px;">No OSBP contact information available for the selected agencies.</p>';
    }
    return contacts.map((contact: any) => `
      <div class="card">
        <div class="card-title">${contact.subAgency || 'Small Business Office'}</div>
        <p><strong>Director:</strong> ${contact.director || 'Contact office for details'}</p>
        <p><strong>Email:</strong> <a href="mailto:${contact.email}">${contact.email}</a></p>
        <p><strong>Phone:</strong> ${contact.phone || 'N/A'}</p>
        <p><strong>Website:</strong> ${contact.website ? `<a href="${contact.website}" target="_blank">${contact.website}</a>` : 'N/A'}</p>
        <p><strong>Covers ${contact.agencies.length} office${contact.agencies.length !== 1 ? 's' : ''}:</strong> ${contact.agencies.slice(0, 5).join(', ')}${contact.agencies.length > 5 ? ` +${contact.agencies.length - 5} more` : ''}</p>
      </div>
    `).join('');
  })()}

  ${tier === 'premium' ? `
  <!-- Subcontracting Report -->
  <h2>🤝 Subcontracting Opportunities</h2>
  <div class="section-intro">Prime contractors and Tier 2 subcontracting opportunities.</div>

  <h3>Subcontracting Summary</h3>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${reports.tier2Subcontracting.summary.totalPrimes}</div>
      <div class="stat-label">Tier 2 Opportunities</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${reports.primeContractor.summary.totalPrimes}</div>
      <div class="stat-label">Prime Opportunities</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${reports.primeContractor.summary.totalOtherAgencies}</div>
      <div class="stat-label">Other Agencies</div>
    </div>
  </div>

  <h3>Tier 2 Subcontracting Opportunities</h3>
  ${(reports.tier2Subcontracting.suggestedPrimes || []).map((prime: any) => `
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
        <div>
          <div class="card-title" style="font-size: 18px;">${prime.name || 'Unknown'}</div>
          <div style="margin-top: 8px;">
            ${prime.phone ? '<span class="badge" style="background: #fef3c7; color: #92400e; margin-right: 5px;">📱 PHONE</span>' : ''}
            ${prime.email ? '<span class="badge" style="background: #dcfce7; color: #166534; margin-right: 5px;">✉️ EMAIL</span>' : ''}
            ${prime.hasSubcontractPlan ? '<span class="badge" style="background: #fef3c7; color: #b45309; margin-right: 5px;">📋 SUBCONTRACT PLAN</span>' : ''}
            ${prime.supplierPortal ? '<span class="badge" style="background: #dbeafe; color: #1e40af;">🌐 PORTAL</span>' : ''}
          </div>
        </div>
        ${prime.totalContractValue ? `<span style="background: #1e293b; color: white; padding: 8px 16px; border-radius: 8px; font-weight: bold;">$${(prime.totalContractValue / 1000000).toFixed(2)}M</span>` : ''}
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 12px;">
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">CONTRACTS</p>
          <p style="font-weight: 500;">${prime.contractCount ? `${prime.contractCount} contracts` : 'N/A'}</p>
        </div>
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">SBLO CONTACT</p>
          <p style="font-weight: 500;">${prime.sbloName || 'Contact SBLO'}</p>
        </div>
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">PHONE</p>
          <p style="font-weight: 500;">${prime.phone ? `<a href="tel:${prime.phone}" style="color: #059669;">${prime.phone}</a>` : 'N/A'}</p>
        </div>
      </div>
      ${prime.email ? `
        <div style="margin-bottom: 12px;">
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">EMAIL</p>
          <a href="mailto:${prime.email}" style="color: #2563eb;">${prime.email}</a>
        </div>
      ` : ''}
      ${prime.relevantAgencies && prime.relevantAgencies.length > 0 ? `
        <div style="margin-bottom: 12px;">
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">PRIMARY AGENCIES</p>
          <div>${prime.relevantAgencies.map((agency: string) => `<span class="badge badge-blue" style="margin-right: 5px; margin-bottom: 5px;">${agency}</span>`).join('')}</div>
        </div>
      ` : ''}
      ${prime.naicsCategories && prime.naicsCategories.length > 0 ? `
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">NAICS CODES</p>
          <div>${prime.naicsCategories.slice(0, 6).map((naics: string) => `<span class="badge badge-purple" style="margin-right: 5px; margin-bottom: 5px;">${naics}</span>`).join('')}${prime.naicsCategories.length > 6 ? `<span class="badge" style="background: #f1f5f9; color: #64748b;">+${prime.naicsCategories.length - 6} more</span>` : ''}</div>
        </div>
      ` : ''}
    </div>
  `).join('')}

  <h3>Prime Contractor Opportunities</h3>
  ${(reports.primeContractor.suggestedPrimes || []).map((prime: any) => `
    <div class="card" style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
        <div>
          <div class="card-title" style="font-size: 18px;">${prime.name || 'Unknown'}</div>
          <div style="margin-top: 8px;">
            ${prime.phone ? '<span class="badge" style="background: #fef3c7; color: #92400e; margin-right: 5px;">📱 PHONE</span>' : ''}
            ${prime.email ? '<span class="badge" style="background: #dcfce7; color: #166534; margin-right: 5px;">✉️ EMAIL</span>' : ''}
            ${prime.hasSubcontractPlan ? '<span class="badge" style="background: #fef3c7; color: #b45309; margin-right: 5px;">📋 SUBCONTRACT PLAN</span>' : ''}
            ${prime.supplierPortal ? '<span class="badge" style="background: #dbeafe; color: #1e40af;">🌐 PORTAL</span>' : ''}
          </div>
        </div>
        ${prime.totalContractValue ? `<span style="background: #1e293b; color: white; padding: 8px 16px; border-radius: 8px; font-weight: bold;">$${(prime.totalContractValue / 1000000).toFixed(2)}M</span>` : ''}
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 12px;">
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">CONTRACTS</p>
          <p style="font-weight: 500;">${prime.contractCount ? `${prime.contractCount} contracts` : 'N/A'}</p>
        </div>
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">SBLO CONTACT</p>
          <p style="font-weight: 500;">${prime.sbloName || 'Contact SBLO'}</p>
        </div>
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">PHONE</p>
          <p style="font-weight: 500;">${prime.phone ? `<a href="tel:${prime.phone}" style="color: #059669;">${prime.phone}</a>` : 'N/A'}</p>
        </div>
      </div>
      ${prime.email ? `
        <div style="margin-bottom: 12px;">
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">EMAIL</p>
          <a href="mailto:${prime.email}" style="color: #2563eb;">${prime.email}</a>
        </div>
      ` : ''}
      ${prime.relevantAgencies && prime.relevantAgencies.length > 0 ? `
        <div style="margin-bottom: 12px;">
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">PRIMARY AGENCIES</p>
          <div>${prime.relevantAgencies.map((agency: string) => `<span class="badge badge-blue" style="margin-right: 5px; margin-bottom: 5px;">${agency}</span>`).join('')}</div>
        </div>
      ` : ''}
      ${prime.naicsCategories && prime.naicsCategories.length > 0 ? `
        <div>
          <p style="font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 8px;">NAICS CODES</p>
          <div>${prime.naicsCategories.slice(0, 6).map((naics: string) => `<span class="badge badge-purple" style="margin-right: 5px; margin-bottom: 5px;">${naics}</span>`).join('')}${prime.naicsCategories.length > 6 ? `<span class="badge" style="background: #f1f5f9; color: #64748b;">+${prime.naicsCategories.length - 6} more</span>` : ''}</div>
        </div>
      ` : ''}
    </div>
  `).join('')}
  ` : ''}

  ${tier === 'premium' ? `
  <!-- IDV Contracts Report -->
  <h2>📋 IDV Vehicle Contracts</h2>
  <div class="section-intro">Indefinite Delivery Vehicles (IDVs) and contract vehicles for your NAICS code.</div>
  <table>
    <thead>
      <tr><th>Contract</th><th>Agency</th><th>Value</th><th>Type</th></tr>
    </thead>
    <tbody>
      ${(reports.idvContracts?.contracts || []).slice(0, 20).map((contract: any) => `
        <tr>
          <td><strong>${contract.name || contract.title || 'Contract'}</strong></td>
          <td>${contract.agency || 'N/A'}</td>
          <td class="amount">${contract.value ? '$' + (contract.value / 1000000).toFixed(2) + 'M' : 'N/A'}</td>
          <td><span class="badge badge-green">${contract.type || contract.setAside || 'IDV'}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <!-- Similar Awards Report -->
  <h2>📊 Similar Awards in Your NAICS</h2>
  <div class="section-intro">Historical contract awards matching your NAICS code - use these to identify buying offices and present your capabilities.</div>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">$${(reports.decemberSpend.summary.totalQ4Spend / 1000000).toFixed(1)}M</div>
      <div class="stat-label">Total Award Value</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${reports.decemberSpend.summary.urgentOpportunities}</div>
      <div class="stat-label">Similar Awards Found</div>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>Agency</th><th>Description</th><th>Award Value</th><th>Relevance</th></tr>
    </thead>
    <tbody>
      ${reports.decemberSpend.opportunities.slice(0, 20).map((opp: any) => `
        <tr>
          <td><strong>${opp.agency}</strong></td>
          <td>${opp.program || '-'}</td>
          <td class="amount">$${(opp.estimatedQ4Spend / 1000000).toFixed(2)}M</td>
          <td><span class="badge ${opp.urgencyLevel === 'high' ? 'badge-purple' : 'badge-blue'}">${opp.urgencyLevel}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <!-- Tribal Contracting Report -->
  <h2>🏛️ Tribal Contracting Opportunities</h2>
  <div class="section-intro">8(a) and tribal contracting opportunities.</div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${reports.tribalContracting?.summary?.totalOpportunities || 0}</div>
      <div class="stat-label">Total Opportunities</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${((reports.tribalContracting?.summary?.totalValue || 0) / 1000000).toFixed(1)}M</div>
      <div class="stat-label">Estimated Value</div>
    </div>
  </div>

  <h3>Suggested Tribal Businesses</h3>
  ${(reports.tribalContracting?.suggestedTribes || []).map((tribe: any) => `
    <div class="card" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
        <div class="card-title" style="font-size: 16px;">${tribe.name || 'Unknown'}</div>
        <span style="color: #64748b; font-size: 14px;">${tribe.region || ''}</span>
      </div>
      ${tribe.capabilities && tribe.capabilities.length > 0 ? `
        <p style="margin: 8px 0; font-size: 14px;"><strong>Capabilities:</strong> ${tribe.capabilities.join(', ')}</p>
      ` : ''}
      ${tribe.certifications && tribe.certifications.length > 0 ? `
        <p style="margin: 8px 0; font-size: 14px; color: #166534;"><strong>Certifications:</strong> ${tribe.certifications.join(', ')}</p>
      ` : ''}
      ${tribe.naicsCategories && tribe.naicsCategories.length > 0 ? `
        <p style="margin: 8px 0; font-size: 14px;"><strong>NAICS:</strong> ${tribe.naicsCategories.join(', ')}</p>
      ` : ''}
      ${tribe.contactInfo ? `
        <p style="margin: 8px 0; font-size: 14px; color: #1d4ed8;">
          <strong>Contact:</strong> ${tribe.contactInfo.name || ''}
          ${tribe.contactInfo.email ? `- <a href="mailto:${tribe.contactInfo.email}">${tribe.contactInfo.email}</a>` : ''}
          ${tribe.contactInfo.phone ? ` | ${tribe.contactInfo.phone}` : ''}
        </p>
      ` : ''}
    </div>
  `).join('')}

  ${reports.tribalContracting?.recommendedAgencies && reports.tribalContracting.recommendedAgencies.length > 0 ? `
    <h3>Recommended Agencies for Tribal Contracting</h3>
    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;">
      ${reports.tribalContracting.recommendedAgencies.map((agency: string) => `
        <span class="badge badge-purple">${agency}</span>
      `).join('')}
    </div>
  ` : ''}

  ${reports.tribalContracting?.recommendations && reports.tribalContracting.recommendations.length > 0 ? `
    <h3>Recommendations</h3>
    <ul style="margin: 0; padding-left: 20px;">
      ${reports.tribalContracting.recommendations.map((rec: string) => `
        <li style="margin-bottom: 8px; color: #334155;">${rec}</li>
      `).join('')}
    </ul>
  ` : ''}
  ` : `
  <!-- Premium Upgrade Notice -->
  <div style="background: linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 30px; text-align: center; margin-top: 40px;">
    <h2 style="color: #92400e; margin-bottom: 15px;">🔒 Unlock 4 More Premium Reports</h2>
    <p style="color: #78350f; margin-bottom: 20px;">Upgrade to Premium to access:</p>
    <ul style="list-style: none; padding: 0; color: #92400e; margin-bottom: 20px;">
      <li style="margin-bottom: 8px;">🤝 Subcontracting Opportunities</li>
      <li style="margin-bottom: 8px;">📋 IDV Vehicle Contracts</li>
      <li style="margin-bottom: 8px;">📊 Similar Awards Analysis</li>
      <li style="margin-bottom: 8px;">🏛️ Tribal Contracting</li>
    </ul>
    <p style="color: #78350f; font-weight: bold;">Visit tools.govcongiants.org to upgrade to Premium</p>
  </div>
  `}

  <hr style="margin-top: 40px;">
  <div style="text-align: center; margin-top: 30px;">
    <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
    <p style="color: #64748b; font-size: 12px; margin-top: 10px;">
      Generated by Federal Market Assassin | ${new Date().toISOString()}
    </p>
    <p style="color: #94a3b8; font-size: 11px;">
      © ${new Date().getFullYear()} GovCon Giants. All rights reserved. | govcongiants.org
    </p>
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `federal-market-assassin-full-report-${new Date().toISOString().split('T')[0]}.html`;
    link.click();
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl">
      {/* Header */}
      <div className="p-8 border-b border-slate-700">
        <div className="flex justify-between items-start">
          <div>
            <div className="mb-2">
              <span className="text-xl font-bold text-blue-400">GovCon</span>
              <span className="text-xl font-bold text-amber-400">Giants</span>
            </div>
            <h2 className="text-3xl font-bold text-slate-100 mb-2">
              Your Comprehensive Market Reports
            </h2>
            <p className="text-slate-400">
              Generated for <strong className="text-cyan-400">{reports.metadata.selectedAgencies.length}</strong> agencies on{' '}
              {new Date(reports.metadata.generatedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleExportHTML}
              className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 font-semibold rounded-lg transition-colors border border-purple-500/30"
            >
              Export All (HTML)
            </button>
            <button
              onClick={handleExportCSV}
              disabled={exportingCSV}
              className={`px-4 py-2 font-semibold rounded-lg transition-colors ${
                exportingCSV
                  ? 'bg-emerald-500/20 text-emerald-400/50 cursor-wait border border-emerald-500/20'
                  : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {exportingCSV ? 'Exporting...' : 'Export CSV'}
            </button>
            <button
              onClick={handleExportPDF}
              className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-semibold rounded-lg transition-colors border border-blue-500/30"
            >
              Print All (PDF)
            </button>
            <button
              onClick={onReset}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold rounded-lg transition-colors"
            >
              New Report
            </button>
          </div>
        </div>
      </div>

      {/* Search Criteria */}
      <div className="px-8 py-4 bg-slate-900/50 border-b border-slate-700">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Search Criteria</p>
        <div className="flex flex-wrap gap-3">
          {reports.metadata.inputs.businessType && (
            <span className="px-3 py-1.5 bg-blue-500/20 text-blue-400 text-sm font-medium rounded-full border border-blue-500/30">
              {reports.metadata.inputs.businessType}
            </span>
          )}
          {reports.metadata.inputs.naicsCode && (
            <span className="px-3 py-1.5 bg-purple-500/20 text-purple-400 text-sm font-medium rounded-full border border-purple-500/30">
              NAICS: {reports.metadata.inputs.naicsCode}
            </span>
          )}
          {reports.metadata.inputs.zipCode && (
            <span className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 text-sm font-medium rounded-full border border-emerald-500/30">
              ZIP: {reports.metadata.inputs.zipCode}
            </span>
          )}
          {reports.metadata.inputs.veteranStatus && reports.metadata.inputs.veteranStatus !== 'Not Applicable' && (
            <span className="px-3 py-1.5 bg-amber-500/20 text-amber-400 text-sm font-medium rounded-full border border-amber-500/30">
              {reports.metadata.inputs.veteranStatus}
            </span>
          )}
          {reports.metadata.inputs.pscCode && (
            <span className="px-3 py-1.5 bg-cyan-500/20 text-cyan-400 text-sm font-medium rounded-full border border-cyan-500/30">
              PSC: {reports.metadata.inputs.pscCode}
            </span>
          )}
        </div>
      </div>

      {/* Enhanced Tabs - Mobile Responsive */}
      {!showAllForExport && (
        <>
          {/* Mobile: Dropdown selector */}
          <div className="md:hidden border-b border-slate-700/50 p-4 bg-slate-900/30 print:hidden">
            <label className="block text-xs text-slate-500 mb-2 font-medium">SELECT REPORT</label>
            <div className="relative">
              <select
                value={activeTab}
                onChange={(e) => {
                  const tabId = e.target.value as ReportTab;
                  if (isSectionLocked(tabId)) {
                    setShowUpgradeModal(true);
                  } else {
                    setActiveTab(tabId);
                  }
                }}
                className="w-full appearance-none bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 pr-10 text-slate-200 font-medium focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              >
                {tabs.map((tab) => {
                  const locked = isSectionLocked(tab.id);
                  return (
                    <option key={tab.id} value={tab.id}>
                      {tab.icon} {tab.label.replace(/^[^\s]+\s/, '')} {locked ? '🔒 PRO' : ''}
                    </option>
                  );
                })}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            {/* Quick nav pills */}
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
              {tabs.slice(0, 4).map((tab) => {
                const locked = isSectionLocked(tab.id);
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (locked) {
                        setShowUpgradeModal(true);
                      } else {
                        setActiveTab(tab.id);
                      }
                    }}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-cyan-500 text-white'
                        : locked
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {tab.icon}
                  </button>
                );
              })}
              <span className="flex-shrink-0 px-2 py-1.5 text-slate-500 text-xs">+{tabs.length - 4} more</span>
            </div>
          </div>

          {/* Desktop: Horizontal tabs */}
          <div className="hidden md:block border-b border-slate-700/50 overflow-x-auto print:hidden bg-slate-900/30">
            <div className="flex px-4 gap-1">
              {tabs.map((tab) => {
                const locked = isSectionLocked(tab.id);
                const isActive = activeTab === tab.id && !locked;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (locked) {
                        setShowUpgradeModal(true);
                      } else {
                        setActiveTab(tab.id);
                      }
                    }}
                    className={`relative px-4 py-3 font-medium text-sm whitespace-nowrap transition-all duration-200 flex items-center gap-2 rounded-t-lg ${
                      isActive
                        ? 'bg-slate-800/80 text-cyan-400 border-t-2 border-x border-cyan-400 border-slate-700/50 -mb-px'
                        : locked
                          ? 'text-slate-500 hover:text-slate-400 hover:bg-slate-800/30 cursor-pointer group'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                    }`}
                  >
                    <span className="text-base">{tab.icon}</span>
                    <span>{tab.label.replace(/^[^\s]+\s/, '')}</span>
                    {locked && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/20 rounded-full border border-amber-500/30 group-hover:bg-amber-500/30 transition-colors">
                        <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                        <span className="text-xs text-amber-400 font-semibold">PRO</span>
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Report Content - Show all when exporting, otherwise show active tab */}
      <div className="p-4 md:p-8">
        {showAllForExport ? (
          // Show reports for printing/exporting - respects tier access
          <div className="space-y-12">
            <div className="print:break-after-page">
              <h2 className="text-2xl font-bold text-slate-100 mb-6 border-b-2 border-cyan-500 pb-2">Government Buyers Report</h2>
              <GovernmentBuyersReport data={reports.governmentBuyers} onAgencyClick={openAgencyModal} />
            </div>

            <div className="print:break-after-page">
              <h2 className="text-2xl font-bold text-slate-100 mb-6 border-b-2 border-cyan-500 pb-2">OSBP Contacts</h2>
              <OSBPContactsReport data={reports.governmentBuyers} />
            </div>

            {/* Premium-only sections */}
            {!isSectionLocked('subcontracting') && (
              <div className="print:break-after-page">
                <h2 className="text-2xl font-bold text-slate-100 mb-6 border-b-2 border-cyan-500 pb-2">Subcontracting Opportunities</h2>
                <SubcontractingReport tier2Data={reports.tier2Subcontracting} primeData={reports.primeContractor} />
              </div>
            )}

            {!isSectionLocked('idvContracts') && (
              <div className="print:break-after-page">
                <h2 className="text-2xl font-bold text-slate-100 mb-6 border-b-2 border-cyan-500 pb-2">IDV Vehicle Contracts</h2>
                <IDVContractsReport data={reports.idvContracts} inputs={reports.metadata.inputs} />
              </div>
            )}

            {!isSectionLocked('december') && (
              <div className="print:break-after-page">
                <h2 className="text-2xl font-bold text-slate-100 mb-6 border-b-2 border-cyan-500 pb-2">Similar Awards in Your NAICS</h2>
                <DecemberSpendReport data={reports.decemberSpend} inputs={reports.metadata.inputs} />
              </div>
            )}

            {!isSectionLocked('tribal') && (
              <div>
                <h2 className="text-2xl font-bold text-slate-100 mb-6 border-b-2 border-cyan-500 pb-2">Tribal Contracting</h2>
                <TribalReport data={reports.tribalContracting} />
              </div>
            )}

            {/* Show upgrade message for Standard users */}
            {tier === 'standard' && (
              <div className="print:break-after-page bg-amber-500/10 border-2 border-amber-500/50 rounded-xl p-8 text-center">
                <h2 className="text-2xl font-bold text-amber-400 mb-4">Unlock 4 More Premium Reports</h2>
                <p className="text-amber-300 mb-4">Upgrade to Premium to access:</p>
                <ul className="text-slate-300 mb-6 space-y-2">
                  <li>Subcontracting Opportunities</li>
                  <li>IDV Vehicle Contracts</li>
                  <li>Similar Awards Analysis</li>
                  <li>Tribal Contracting</li>
                </ul>
                <p className="text-amber-400 font-bold">Visit tools.govcongiants.org to upgrade</p>
              </div>
            )}
          </div>
        ) : (
          // Normal tabbed view
          <>
            {activeTab === 'analytics' && (
              <div className="space-y-6">
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-bold text-white mb-2">Market Analytics Dashboard</h2>
                  <p className="text-slate-400">Visual insights into your target agencies and spending patterns</p>
                </div>
                <AgencySpendingChart agencies={reports.governmentBuyers.agencies} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <SpendingTrendChart
                    forecasts={reports.forecastList?.forecasts}
                    agencies={reports.governmentBuyers.agencies}
                  />
                  <GeographicDistributionChart agencies={reports.governmentBuyers.agencies} />
                </div>
              </div>
            )}
            {activeTab === 'buyers' && <GovernmentBuyersReport data={reports.governmentBuyers} onAgencyClick={openAgencyModal} />}
            {activeTab === 'subcontracting' && (
              isSectionLocked('subcontracting') ? (
                <LockedSectionOverlay
                  sectionName="Subcontracting Opportunities"
                  onUpgrade={() => setShowUpgradeModal(true)}
                />
              ) : (
                <SubcontractingReport tier2Data={reports.tier2Subcontracting} primeData={reports.primeContractor} />
              )
            )}
            {activeTab === 'idvContracts' && (
              isSectionLocked('idvContracts') ? (
                <LockedSectionOverlay
                  sectionName="IDV Contracts"
                  onUpgrade={() => setShowUpgradeModal(true)}
                />
              ) : (
                <IDVContractsReport data={reports.idvContracts} inputs={reports.metadata.inputs} />
              )
            )}
            {activeTab === 'osbpContacts' && <OSBPContactsReport data={reports.governmentBuyers} />}
            {activeTab === 'december' && (
              isSectionLocked('december') ? (
                <LockedSectionOverlay
                  sectionName="Similar Awards"
                  onUpgrade={() => setShowUpgradeModal(true)}
                />
              ) : (
                <DecemberSpendReport data={reports.decemberSpend} inputs={reports.metadata.inputs} />
              )
            )}
            {activeTab === 'tribal' && (
              isSectionLocked('tribal') ? (
                <LockedSectionOverlay
                  sectionName="Tribal Contracting"
                  onUpgrade={() => setShowUpgradeModal(true)}
                />
              ) : (
                <TribalReport data={reports.tribalContracting} />
              )
            )}
          </>
        )}
      </div>

      {/* Agency Details Modal */}
      {modalAgency && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={closeAgencyModal}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-100">{modalAgency.name}</h2>
              <button
                onClick={closeAgencyModal}
                className="text-slate-400 hover:text-slate-200 text-3xl font-bold leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Key Statistics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Spending</div>
                  <div className="text-2xl font-bold text-blue-400">{modalAgency.spending ? formatCurrency(modalAgency.spending) : 'N/A'}</div>
                </div>
                <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Contracts</div>
                  <div className="text-2xl font-bold text-slate-200">{modalAgency.contractCount || 'N/A'}</div>
                </div>
                <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Location</div>
                  <div className="text-lg font-bold text-emerald-400">{modalAgency.location || 'N/A'}</div>
                </div>
                <div className="bg-purple-500/20 border border-purple-500/30 rounded-lg p-4">
                  <div className="text-sm text-slate-400 mb-1">Office ID</div>
                  <div className="text-lg font-bold text-purple-400">{formatOfficeId(modalAgency.officeId, modalAgency.command)}</div>
                </div>
              </div>

              {/* Office Information */}
              <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-100 mb-4">Office Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-slate-400">Contracting Office</div>
                    <div className="text-base font-semibold text-slate-100">{modalAgency.contractingOffice || modalAgency.name}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400">Sub-Agency</div>
                    <div className="text-base font-semibold text-slate-100">{modalAgency.subAgency || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400">Parent Agency</div>
                    <div className="text-base font-semibold text-slate-100">{modalAgency.parentAgency || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400">Location</div>
                    <div className="text-base text-slate-100">{modalAgency.location || 'Not specified'}</div>
                  </div>
                </div>
              </div>

              {/* Quick Links */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-100 mb-4">Market Research Links</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <a
                    href={getSamSearchUrl(modalAgency.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition border border-slate-600"
                  >
                    <div>
                      <div className="font-semibold text-slate-100">SAM.gov Opportunities</div>
                      <div className="text-sm text-slate-400">Search active contracts</div>
                    </div>
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <a
                    href="https://www.usaspending.gov/search"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between bg-slate-800 rounded-lg p-4 hover:bg-slate-700 transition border border-slate-600"
                  >
                    <div>
                      <div className="font-semibold text-slate-100">USAspending.gov</div>
                      <div className="text-sm text-slate-400">View spending history</div>
                    </div>
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Agency Pain Points */}
              <div className="bg-purple-500/10 border-l-4 border-purple-500 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-purple-300 mb-3">Agency Priorities & Pain Points</h3>
                {loadingPainPoints ? (
                  <p className="text-sm text-purple-400">Loading agency insights...</p>
                ) : painPointsData && painPointsData.painPoints && painPointsData.painPoints.length > 0 ? (
                  <div className="space-y-4">
                    {/* Show which command was matched */}
                    {matchedCommand && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-3 py-1 bg-purple-600 text-white text-sm font-bold rounded-full">
                          {matchedCommand}
                        </span>
                        <span className="text-xs text-purple-400">
                          {painPointsData.painPoints.length} priorities identified
                        </span>
                      </div>
                    )}
                    {/* Show categorized pain points if available */}
                    {painPointsData.categorized && Object.keys(painPointsData.categorized).length > 0 ? (
                      Object.entries(painPointsData.categorized).map(([category, points]) => (
                        points && points.length > 0 && (
                          <div key={category}>
                            <h4 className="font-semibold text-purple-300 mb-2 capitalize">{category}</h4>
                            <ul className="space-y-2 text-sm text-purple-200">
                              {points.map((painPoint, index) => (
                                <li key={index} className="flex items-start">
                                  <span className="text-purple-400 mr-2">•</span>
                                  <span className="flex-1">{painPoint}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      ))
                    ) : (
                      /* Fallback: show raw pain points if categorized is empty */
                      <div>
                        <h4 className="font-semibold text-purple-300 mb-2">Key Priorities</h4>
                        <ul className="space-y-2 text-sm text-purple-200">
                          {painPointsData.painPoints.map((painPoint, index) => (
                            <li key={index} className="flex items-start">
                              <span className="text-purple-400 mr-2">•</span>
                              <span className="flex-1">{painPoint}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {painPointsData.ndaaPainPoints && painPointsData.ndaaPainPoints.length > 0 && (
                      <div className="pt-4 border-t border-purple-500/30">
                        <h4 className="font-semibold text-purple-300 mb-2">NDAA Priorities</h4>
                        <ul className="space-y-2 text-sm text-purple-300">
                          {painPointsData.ndaaPainPoints.map((painPoint, index) => (
                            <li key={index} className="flex items-start">
                              <span className="text-purple-400 mr-2">•</span>
                              <span>{painPoint}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Show additional commands if found */}
                    {additionalCommands.length > 0 && (
                      <div className="pt-4 border-t border-purple-500/30 space-y-4">
                        <h4 className="font-semibold text-purple-300">Related Commands</h4>
                        {additionalCommands.map((cmd, cmdIdx) => (
                          <div key={cmdIdx} className="bg-slate-700/50 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="px-2 py-1 bg-indigo-500 text-white text-xs font-bold rounded">
                                {cmd.command}
                              </span>
                              <span className="text-xs text-indigo-400">
                                {cmd.painPoints.painPoints.length} priorities
                              </span>
                            </div>
                            <ul className="space-y-1 text-sm text-purple-200">
                              {cmd.painPoints.painPoints.slice(0, 3).map((pp, ppIdx) => (
                                <li key={ppIdx} className="flex items-start">
                                  <span className="text-indigo-400 mr-2">•</span>
                                  <span className="flex-1">{pp}</span>
                                </li>
                              ))}
                              {cmd.painPoints.painPoints.length > 3 && (
                                <li className="text-xs text-indigo-400 italic">
                                  +{cmd.painPoints.painPoints.length - 3} more priorities...
                                </li>
                              )}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-purple-400 italic">
                    Agency priorities data not available for this office yet.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  onClick={closeAgencyModal}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200 font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Modal for Standard tier users */}
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        currentTier={tier}
      />

      {/* Persistent Upgrade Banner for Standard tier users - Mobile Responsive */}
      {tier === 'standard' && !showUpgradeModal && (
        <div className="fixed bottom-0 left-0 right-0 z-40 print:hidden">
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-t border-amber-500/30 shadow-2xl">
            {/* Mobile Layout */}
            <div className="md:hidden p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xl flex-shrink-0">⭐</span>
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm font-semibold truncate">
                      4 reports locked
                    </p>
                    <p className="text-amber-400 text-xs font-bold">$497 lifetime</p>
                  </div>
                </div>
                <a
                  href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
                  className="flex-shrink-0 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black text-sm font-bold rounded-lg"
                >
                  Upgrade
                </a>
              </div>
            </div>

            {/* Desktop Layout */}
            <div className="hidden md:block">
              <div className="max-w-6xl mx-auto px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  {/* Left: Message */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-12 h-12 bg-amber-500/20 rounded-xl border border-amber-500/30">
                      <span className="text-2xl">⭐</span>
                    </div>
                    <div>
                      <p className="text-slate-200 font-semibold">
                        You&apos;re on <span className="text-blue-400">Standard</span> – Unlock all 8 reports + unlimited usage
                      </p>
                      <p className="text-slate-400 text-sm">
                        4 premium reports locked: IDV Contracts, Similar Awards, Subcontracting, Tribal
                      </p>
                    </div>
                  </div>

                  {/* Right: CTA */}
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-amber-400 font-bold text-xl">$497</p>
                      <p className="text-slate-500 text-xs">lifetime access</p>
                    </div>
                    <a
                      href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
                      className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold rounded-lg transition-all glow-amber whitespace-nowrap"
                    >
                      Upgrade to Premium
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Premium Exclusive Badge Component
function PremiumExclusiveBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/40 rounded-full">
      <span className="text-amber-400 text-xs font-bold tracking-wide">PREMIUM EXCLUSIVE</span>
      <span className="text-sm">👑</span>
    </div>
  );
}

// Individual Report Components (simplified versions - can be expanded)

function SubcontractingReport({ tier2Data, primeData }: { tier2Data: any; primeData: any }) {
  return (
    <div className="space-y-6">
      {/* Premium badge */}
      <div className="flex items-center justify-between">
        <PremiumExclusiveBadge />
        <span className="text-slate-500 text-sm">Full access to subcontracting intelligence</span>
      </div>

      <div className="bg-gradient-to-br from-amber-500/10 via-blue-500/10 to-amber-500/10 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-xl font-bold text-amber-300 mb-4 flex items-center gap-2">
          <span>🔗</span> Executive Summary
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-blue-400">Tier 2 Opportunities</p>
            <p className="text-2xl font-bold text-blue-300">{tier2Data.summary.totalPrimes}</p>
          </div>
          <div>
            <p className="text-sm text-blue-400">Prime Opportunities</p>
            <p className="text-2xl font-bold text-blue-300">{primeData.summary.totalPrimes}</p>
          </div>
          <div>
            <p className="text-sm text-blue-400">Other Agencies</p>
            <p className="text-2xl font-bold text-blue-300">{primeData.summary.totalOtherAgencies}</p>
          </div>
        </div>
      </div>

      {/* Tier 2 Subcontracting Opportunities */}
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">Tier 2 Subcontracting Opportunities</h3>
        <div className="space-y-4">
          {tier2Data.suggestedPrimes.map((prime: any, idx: number) => (
            <div key={`tier2-${idx}`} className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-all card-hover">
              {/* Header Row */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-bold text-slate-100 text-xl mb-2">{prime.name}</h4>
                  {/* Contact Tags */}
                  <div className="flex flex-wrap gap-2">
                    {prime.phone && (
                      <span className="px-3 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded-full flex items-center gap-1 border border-amber-500/30">
                        📱 PHONE
                      </span>
                    )}
                    {prime.email && (
                      <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded-full flex items-center gap-1 border border-emerald-500/30">
                        ✉️ EMAIL
                      </span>
                    )}
                    {prime.hasSubcontractPlan && (
                      <span className="px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-bold rounded-full flex items-center gap-1 border border-amber-500/30">
                        📋 SUBCONTRACT PLAN
                      </span>
                    )}
                    {prime.supplierPortal && (
                      <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded-full flex items-center gap-1 border border-blue-500/30">
                        🌐 PORTAL
                      </span>
                    )}
                  </div>
                </div>
                {/* Contract Value Badge */}
                {prime.totalContractValue && (
                  <span className="px-4 py-2 bg-emerald-500/20 text-emerald-400 text-sm font-bold rounded-lg border border-emerald-500/30">
                    {formatCurrency(prime.totalContractValue)}
                  </span>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-3 gap-6 mb-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">CONTRACTS</p>
                  <p className="text-slate-200 font-medium">{prime.contractCount ? `${prime.contractCount} contracts` : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">SBLO CONTACT</p>
                  <p className="text-slate-200 font-medium">{prime.sbloName || 'Contact SBLO'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">PHONE</p>
                  {prime.phone ? (
                    <a href={`tel:${prime.phone}`} className="text-emerald-400 font-medium hover:underline">
                      {prime.phone}
                    </a>
                  ) : (
                    <p className="text-slate-500">N/A</p>
                  )}
                </div>
              </div>

              {/* Email Row */}
              {prime.email && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">EMAIL</p>
                  <a href={`mailto:${prime.email}`} className="text-blue-400 font-medium hover:underline">
                    {prime.email}
                  </a>
                </div>
              )}

              {/* Agencies */}
              {prime.relevantAgencies && prime.relevantAgencies.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">PRIMARY AGENCIES</p>
                  <div className="flex flex-wrap gap-2">
                    {prime.relevantAgencies.map((agency: string, aIdx: number) => (
                      <span key={aIdx} className="px-3 py-1 bg-slate-700 text-slate-300 text-sm rounded-full border border-slate-600">
                        {agency}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* NAICS Codes */}
              {prime.naicsCategories && prime.naicsCategories.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">NAICS CODES</p>
                  <div className="flex flex-wrap gap-2">
                    {prime.naicsCategories.slice(0, 6).map((naics: string, nIdx: number) => (
                      <span key={nIdx} className="px-3 py-1 bg-purple-500/20 text-purple-400 text-sm font-medium rounded-full border border-purple-500/30">
                        {naics}
                      </span>
                    ))}
                    {prime.naicsCategories.length > 6 && (
                      <span className="px-3 py-1 bg-slate-700 text-slate-400 text-sm rounded-full border border-slate-600">
                        +{prime.naicsCategories.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Prime Contractor Opportunities */}
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">Prime Contractor Opportunities</h3>
        <div className="space-y-4">
          {primeData.suggestedPrimes.map((prime: any, idx: number) => (
            <div key={`prime-${idx}`} className="bg-slate-800 border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-all card-hover">
              {/* Header Row */}
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-bold text-slate-100 text-xl mb-2">{prime.name}</h4>
                  {/* Contact Tags */}
                  <div className="flex flex-wrap gap-2">
                    {prime.phone && (
                      <span className="px-3 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold rounded-full flex items-center gap-1 border border-amber-500/30">
                        📱 PHONE
                      </span>
                    )}
                    {prime.email && (
                      <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-bold rounded-full flex items-center gap-1 border border-emerald-500/30">
                        ✉️ EMAIL
                      </span>
                    )}
                    {prime.hasSubcontractPlan && (
                      <span className="px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-bold rounded-full flex items-center gap-1 border border-amber-500/30">
                        📋 SUBCONTRACT PLAN
                      </span>
                    )}
                    {prime.supplierPortal && (
                      <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold rounded-full flex items-center gap-1 border border-blue-500/30">
                        🌐 PORTAL
                      </span>
                    )}
                  </div>
                </div>
                {/* Contract Value Badge */}
                {prime.totalContractValue && (
                  <span className="px-4 py-2 bg-emerald-500/20 text-emerald-400 text-sm font-bold rounded-lg border border-emerald-500/30">
                    {formatCurrency(prime.totalContractValue)}
                  </span>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-3 gap-6 mb-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">CONTRACTS</p>
                  <p className="text-slate-200 font-medium">{prime.contractCount ? `${prime.contractCount} contracts` : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">SBLO CONTACT</p>
                  <p className="text-slate-200 font-medium">{prime.sbloName || 'Contact SBLO'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">PHONE</p>
                  {prime.phone ? (
                    <a href={`tel:${prime.phone}`} className="text-emerald-400 font-medium hover:underline">
                      {prime.phone}
                    </a>
                  ) : (
                    <p className="text-slate-500">N/A</p>
                  )}
                </div>
              </div>

              {/* Email Row */}
              {prime.email && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">EMAIL</p>
                  <a href={`mailto:${prime.email}`} className="text-blue-400 font-medium hover:underline">
                    {prime.email}
                  </a>
                </div>
              )}

              {/* Agencies */}
              {prime.agencies && prime.agencies.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">PRIMARY AGENCIES</p>
                  <div className="flex flex-wrap gap-2">
                    {prime.agencies.map((agency: string, aIdx: number) => (
                      <span key={aIdx} className="px-3 py-1 bg-slate-700 text-slate-300 text-sm rounded-full border border-slate-600">
                        {agency}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* NAICS Codes */}
              {prime.naicsCategories && prime.naicsCategories.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">NAICS CODES</p>
                  <div className="flex flex-wrap gap-2">
                    {prime.naicsCategories.slice(0, 6).map((naics: string, nIdx: number) => (
                      <span key={nIdx} className="px-3 py-1 bg-purple-500/20 text-purple-400 text-sm font-medium rounded-full border border-purple-500/30">
                        {naics}
                      </span>
                    ))}
                    {prime.naicsCategories.length > 6 && (
                      <span className="px-3 py-1 bg-slate-700 text-slate-400 text-sm rounded-full border border-slate-600">
                        +{prime.naicsCategories.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Other Agencies to Consider */}
      {primeData.otherAgencies && primeData.otherAgencies.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-slate-100 mb-4">Other Agencies to Consider</h3>
          <div className="space-y-3">
            {primeData.otherAgencies.map((agency: any, idx: number) => (
              <div key={idx} className="border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50">
                <p className="font-semibold text-slate-100 mb-2">{agency.name}</p>
                <p className="text-sm text-slate-300 mb-2"><strong>Reason:</strong> {agency.reason}</p>
                {agency.matchingPainPoints && agency.matchingPainPoints.length > 0 && (
                  <div className="text-sm text-blue-400 mb-2">
                    <strong>Matching Pain Points:</strong>
                    <ul className="list-disc list-inside mt-1">
                      {agency.matchingPainPoints.map((pp: string, ppIdx: number) => (
                        <li key={ppIdx}>{pp}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm text-emerald-400"><strong>Relevance:</strong> {agency.relevance}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {tier2Data.recommendations.map((rec: string, idx: number) => (
            <li key={`tier2-rec-${idx}`} className="flex items-start">
              <span className="text-blue-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
          {primeData.recommendations.map((rec: string, idx: number) => (
            <li key={`prime-rec-${idx}`} className="flex items-start">
              <span className="text-blue-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GovernmentBuyersReport({ data, onAgencyClick }: { data: any; onAgencyClick: (agency: AgencyForModal) => void }) {
  return (
    <div className="space-y-6">
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6">
        <h3 className="text-xl font-bold text-blue-300 mb-4">Executive Summary</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-blue-400">Total Agencies</p>
            <p className="text-2xl font-bold text-blue-300">{data.summary.totalAgencies}</p>
          </div>
          <div>
            <p className="text-sm text-blue-400">Total Spending</p>
            <p className="text-2xl font-bold text-blue-300">
              {formatCurrency(data.summary.totalSpending)}
            </p>
          </div>
          <div>
            <p className="text-sm text-blue-400">Total Contracts</p>
            <p className="text-2xl font-bold text-blue-300">{data.summary.totalContracts}</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">Contracting Offices</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-700">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Office ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Contracting Office / Command</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Sub-Agency</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Location</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Spending</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Contracts</th>
              </tr>
            </thead>
            <tbody className="bg-slate-800 divide-y divide-slate-700">
              {data.agencies.slice(0, 20).map((agency: any, idx: number) => {
                // Contracting office is the command/office that awards contracts (e.g., "Naval Sea Systems Command")
                const contractingOffice = agency.contractingOffice || agency.name;
                // Sub-agency is the intermediate level (e.g., "Department of the Navy")
                // If subAgency equals contractingOffice (no distinct command), show parentAgency instead
                const rawSubAgency = agency.subAgency;
                const subAgency = (rawSubAgency && rawSubAgency !== contractingOffice)
                  ? rawSubAgency
                  : agency.parentAgency || '—';

                // Use helper to format office ID for display
                const displayOfficeId = formatOfficeId(agency.officeId || agency.subAgencyCode, agency.command);

                return (
                  <tr key={idx} className="hover:bg-slate-700/50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <a
                        href={`https://sam.gov/search/?index=opp&page=1&pageSize=25&sort=-modifiedDate&sfm%5Bstatus%5D%5Bis_active%5D=true&q=${encodeURIComponent(contractingOffice)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono bg-blue-500/20 text-blue-400 px-2 py-1 rounded hover:bg-blue-500/30 hover:underline border border-blue-500/30"
                        title={`Search SAM.gov for opportunities from ${contractingOffice}`}
                      >
                        {displayOfficeId || 'N/A'}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => onAgencyClick({
                          name: contractingOffice,
                          contractingOffice,
                          subAgency: agency.subAgency,
                          parentAgency: agency.parentAgency,
                          spending: agency.spending,
                          contractCount: agency.contractCount,
                          location: agency.location,
                          officeId: agency.officeId || agency.subAgencyCode,
                          command: agency.command,
                        })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onAgencyClick({
                            name: contractingOffice,
                            contractingOffice,
                            subAgency: agency.subAgency,
                            parentAgency: agency.parentAgency,
                            spending: agency.spending,
                            contractCount: agency.contractCount,
                            location: agency.location,
                            officeId: agency.officeId || agency.subAgencyCode,
                            command: agency.command,
                          });
                        }}
                        className="font-semibold text-cyan-400 hover:text-cyan-300 hover:underline text-sm cursor-pointer"
                      >
                        {contractingOffice}
                      </span>
                    </td>
                    <td className="px-4 py-3 min-w-[150px]">
                      <p className="text-sm text-slate-400 break-words">{subAgency}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-500">{agency.location}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold text-emerald-400 text-sm">{formatCurrency(agency.spending)}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-sm text-slate-400">{agency.contractCount}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-2 italic">
          Click on Office ID to search for active opportunities on <a href="https://sam.gov" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">SAM.gov</a>
        </p>
      </div>

      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {data.recommendations.map((rec: string, idx: number) => (
            <li key={idx} className="flex items-start">
              <span className="text-emerald-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tier2Report({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-6">
        <h3 className="text-xl font-bold text-purple-300 mb-4">Executive Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-purple-400">Suggested Primes</p>
            <p className="text-2xl font-bold text-purple-300">{data.summary.totalPrimes}</p>
          </div>
          <div>
            <p className="text-sm text-purple-400">Opportunities</p>
            <p className="text-2xl font-bold text-purple-300">{data.summary.opportunityCount}</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">Suggested Prime Contractors</h3>
        <div className="space-y-3">
          {data.suggestedPrimes.map((prime: any, idx: number) => (
            <div key={idx} className="border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50">
              <p className="font-semibold text-slate-100 text-lg mb-2">{prime.name}</p>
              <p className="text-sm text-slate-300 mb-3"><strong>Reason:</strong> {prime.reason}</p>
              <p className="text-sm text-slate-300 mb-2"><strong>Opportunities:</strong> {prime.opportunities.join(', ')}</p>
              <p className="text-sm text-blue-400">{prime.contactStrategy}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {data.recommendations.map((rec: string, idx: number) => (
            <li key={idx} className="flex items-start">
              <span className="text-purple-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ForecastReport({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-6">
        <h3 className="text-xl font-bold text-orange-300 mb-4">Executive Summary</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-orange-400">Total Forecasts</p>
            <p className="text-2xl font-bold text-orange-300">{data.summary.totalForecasts}</p>
          </div>
          <div>
            <p className="text-sm text-orange-400">Estimated Value</p>
            <p className="text-2xl font-bold text-orange-300">
              ${(data.summary.totalValue / 1000000).toFixed(1)}M
            </p>
          </div>
          {data.summary.forecastSources > 0 && (
            <div>
              <p className="text-sm text-orange-400">Forecast Sources</p>
              <p className="text-2xl font-bold text-orange-300">{data.summary.forecastSources}</p>
            </div>
          )}
        </div>
      </div>

      {/* Command-Specific Forecast Resources */}
      {data.forecastResources && data.forecastResources.length > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6">
          <h3 className="text-lg font-bold text-blue-300 mb-4">🔗 Command Forecast Websites</h3>
          <p className="text-sm text-blue-400 mb-4">
            Direct links to forecast pages for your target commands. Check these regularly for new opportunities.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.forecastResources.map((resource: any, idx: number) => (
              <div key={idx} className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                <p className="font-semibold text-slate-100 mb-2">{resource.command}</p>
                <div className="space-y-2">
                  <a
                    href={resource.forecastUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center text-sm text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    <span className="mr-2">📋</span>
                    Official Forecast Page
                  </a>
                  <a
                    href={resource.samForecastUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center text-sm text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    <span className="mr-2">🔍</span>
                    Search on SAM.gov
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.forecasts.length > 0 ? (
        <div>
          <h3 className="text-lg font-bold text-slate-100 mb-4">Upcoming Forecasts</h3>
          <div className="space-y-3">
            {data.forecasts.map((forecast: any, idx: number) => (
              <div key={idx} className="border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-slate-100">{forecast.agency}</p>
                    <p className="text-sm text-slate-400">{forecast.quarter}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-emerald-400">${(forecast.estimatedValue / 1000000).toFixed(1)}M</p>
                    <p className="text-xs text-slate-500">{forecast.solicitationDate}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-300">{forecast.description}</p>
                {(forecast.naicsCode || forecast.setAside) && (
                  <div className="flex gap-2 mt-2">
                    {forecast.naicsCode && (
                      <span className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded border border-slate-600">
                        NAICS: {forecast.naicsCode}
                      </span>
                    )}
                    {forecast.setAside && (
                      <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded border border-emerald-500/30">
                        {forecast.setAside}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-slate-400">
          <p className="mb-2">No forecasts available at this time.</p>
          <p className="text-sm">Check the command forecast websites above for the latest opportunities.</p>
        </div>
      )}

      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {data.recommendations.map((rec: string, idx: number) => (
            <li key={idx} className="flex items-start">
              <span className="text-orange-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface IDVContract {
  awardId: string;
  recipientName: string;
  recipientUei: string;
  awardAmount: number;
  description: string;
  startDate: string;
  endDate: string;
  agency: string;
  subAgency: string;
  naicsCode: string;
  naicsDescription: string;
  recipientState: string;
  popState: string;
  generatedId: string;
  usaSpendingUrl: string;
}

interface SBLOContact {
  sbloName: string | null;
  email: string | null;
  phone: string | null;
  supplierPortal: string | null;
}


function IDVContractsReport({ data, inputs }: { data: any; inputs: CoreInputs }) {
  const [sbloLookup, setSbloLookup] = useState<Record<string, SBLOContact>>({});

  // Load prime contractors database for SBLO lookup
  useEffect(() => {
    async function loadPrimeContractors() {
      try {
        const primeDB = await import('@/data/prime-contractors-database.json');
        const lookup: Record<string, SBLOContact> = {};

        primeDB.primes.forEach((prime: any) => {
          const normalizedName = prime.name?.toUpperCase().trim();
          if (normalizedName) {
            lookup[normalizedName] = {
              sbloName: prime.sbloName,
              email: prime.email,
              phone: prime.phone,
              supplierPortal: prime.supplierPortal
            };
          }
        });

        setSbloLookup(lookup);
      } catch (err) {
        console.error('Failed to load prime contractors database:', err);
      }
    }

    loadPrimeContractors();
  }, []);

  // Function to find SBLO contact by company name
  function findSBLOContact(recipientName: string): SBLOContact | null {
    if (!recipientName) return null;

    const normalizedSearch = recipientName.toUpperCase().trim();

    if (sbloLookup[normalizedSearch]) {
      return sbloLookup[normalizedSearch];
    }

    for (const [name, contact] of Object.entries(sbloLookup)) {
      if (name.includes(normalizedSearch) || normalizedSearch.includes(name)) {
        return contact;
      }
    }

    const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 3);
    for (const [name, contact] of Object.entries(sbloLookup)) {
      for (const word of searchWords) {
        if (name.includes(word)) {
          return contact;
        }
      }
    }

    return null;
  }

  const idvContracts = data?.contracts || [];
  const totalValue = data?.summary?.totalValue || 0;
  const uniquePrimes = data?.summary?.uniquePrimes || 0;

  return (
    <div className="space-y-6">
      {/* Premium badge */}
      <div className="flex items-center justify-between">
        <PremiumExclusiveBadge />
        <span className="text-slate-500 text-sm">Full access to IDV contract intelligence</span>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-br from-amber-500/10 via-emerald-500/10 to-amber-500/10 border border-amber-500/30 rounded-xl p-5">
        <h3 className="text-lg font-bold text-amber-300 mb-2 flex items-center gap-2">
          <span>📋</span> Why IDV Contracts Matter
        </h3>
        <p className="text-sm text-emerald-400">
          IDV (Indefinite Delivery Vehicle) contracts are pre-competed vehicles where prime contractors have already won.
          Instead of bidding on new opportunities, you can partner with these primes as a subcontractor.
          This is often the <strong className="text-emerald-300">fastest path to federal revenue</strong> for small businesses.
        </p>
      </div>

      {/* Stats Bar */}
      {idvContracts.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-indigo-300">{idvContracts.length}</p>
            <p className="text-sm text-indigo-400">IDV Contracts</p>
          </div>
          <div className="bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-indigo-300">{formatCurrency(totalValue)}</p>
            <p className="text-sm text-indigo-400">Total Value</p>
          </div>
          <div className="bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-indigo-300">{uniquePrimes}</p>
            <p className="text-sm text-indigo-400">Prime Contractors</p>
          </div>
        </div>
      )}

      {/* IDV Contracts List */}
      {idvContracts.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-slate-100 mb-4">Active IDV Contracts</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {idvContracts.map((contract: IDVContract, idx: number) => {
              const sbloContact = findSBLOContact(contract.recipientName);
              const hasContactInfo = sbloContact && (sbloContact.email || sbloContact.phone || sbloContact.sbloName);

              return (
                <div key={idx} className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-600 transition-all card-hover">
                  {/* Header Row */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <p className="text-sm text-slate-400 line-clamp-2 mb-2">
                        {contract.description || 'IDV Contract'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {contract.naicsCode && (
                          <span className="px-2 py-1 bg-gradient-to-r from-purple-500 to-indigo-500 text-white text-xs font-semibold rounded">
                            {contract.naicsCode}
                          </span>
                        )}
                        <span className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded border border-slate-600">
                          {contract.subAgency || contract.agency}
                        </span>
                        {hasContactInfo && (
                          <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded border border-emerald-500/30">
                            SBLO Contact Available
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold rounded ml-2">
                      IDV
                    </span>
                  </div>

                  {/* Prime Contractor Box */}
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 mb-4">
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1">PRIME CONTRACTOR</p>
                    <p className="font-bold text-slate-100">{contract.recipientName}</p>
                    <p className="text-sm text-slate-400">
                      {contract.recipientState && `${contract.recipientState}`}
                      {contract.recipientUei && ` | UEI: ${contract.recipientUei}`}
                    </p>
                  </div>

                  {/* SBLO Contact Info */}
                  {hasContactInfo && (
                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4 mb-4">
                      <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">SBLO CONTACT</p>
                      {sbloContact.sbloName && (
                        <p className="text-sm text-slate-100 font-medium">{sbloContact.sbloName}</p>
                      )}
                      {sbloContact.email && (
                        <p className="text-sm">
                          <a href={`mailto:${sbloContact.email}`} className="text-indigo-400 hover:underline">
                            {sbloContact.email}
                          </a>
                        </p>
                      )}
                      {sbloContact.phone && (
                        <p className="text-sm">
                          <a href={`tel:${sbloContact.phone}`} className="text-emerald-400 hover:underline">
                            {sbloContact.phone}
                          </a>
                        </p>
                      )}
                      {sbloContact.supplierPortal && (
                        <p className="text-sm mt-2">
                          <a href={sbloContact.supplierPortal} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                            Supplier Portal →
                          </a>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                    <div>
                      <p className="text-xs text-slate-500 uppercase">Contract Value</p>
                      <p className="font-bold text-indigo-400">{formatCurrency(contract.awardAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase">End Date</p>
                      <p className="text-slate-200">{contract.endDate || 'N/A'}</p>
                    </div>
                  </div>

                  {/* Contract ID */}
                  <div className="mb-4">
                    <p className="text-xs text-slate-500 uppercase">Award ID</p>
                    <p className="text-sm text-slate-300 font-mono">{contract.awardId}</p>
                  </div>

                  {/* Action Link */}
                  <a
                    href={contract.usaSpendingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-4 py-2 bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-sm font-medium rounded-lg hover:bg-indigo-500/30 transition-colors"
                  >
                    View on USAspending.gov →
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {idvContracts.length === 0 && (
        <div className="text-center py-12 text-slate-400 bg-slate-700/50 border border-slate-600 rounded-xl">
          <p className="mb-2 text-lg font-semibold text-slate-300">No IDV contracts found</p>
          <p className="text-sm">No IDV contracts found for {inputs.naicsCode ? `NAICS code ${inputs.naicsCode}` : inputs.pscCode ? `PSC code ${inputs.pscCode}` : 'your criteria'}</p>
        </div>
      )}

      {/* Recommendations */}
      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">IDV Subcontracting Strategy</h3>
        <ul className="space-y-2">
          {(data?.recommendations || [
            'Contact the SBLO (Small Business Liaison Officer) at each prime contractor',
            'Focus on IDVs with 1-2 years remaining - they need to meet subcontracting goals',
            'Register in prime contractor supplier portals (many have them)',
            'Prepare a strong capability statement highlighting your certifications',
            'Large primes are required to subcontract with small businesses - use this leverage',
          ]).map((rec: string, idx: number) => (
            <li key={idx} className="flex items-start">
              <span className="text-indigo-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OSBPContactsReport({ data }: { data: any }) {
  // Filter agencies that have OSBP contacts
  const agenciesWithOSBP = data.agencies.filter((agency: any) => agency.osbp);

  // Build unique OSBP contacts grouped by email, with list of offices they cover
  interface OSBPEntry {
    osbp: any;
    subAgency: string;
    parentAgency: string;
    website: string | null;
    forecastUrl: string | null;
    samForecastUrl: string | null;
    command: string | null;
    offices: Array<{ name: string; spending: number; contractCount: number }>;
  }

  const uniqueOSBPs = new Map<string, OSBPEntry>();

  agenciesWithOSBP.forEach((agency: any) => {
    const email = agency.osbp?.email || 'unknown';

    if (!uniqueOSBPs.has(email)) {
      // Determine the correct subAgency based on the OSBP name/email, not the agency
      // This ensures Navy OSBP is grouped under Navy, not wherever the first agency happened to be
      let osbpSubAgency = agency.subAgency || agency.parentAgency;

      // Check if OSBP email indicates the true parent agency
      const osbpEmail = agency.osbp?.email?.toLowerCase() || '';
      const osbpName = agency.osbp?.name?.toLowerCase() || '';

      if (osbpEmail.includes('navy') || osbpName.includes('navy')) {
        osbpSubAgency = 'Department of the Navy';
      } else if (osbpEmail.includes('army') || osbpName.includes('army')) {
        osbpSubAgency = 'Department of the Army';
      } else if (osbpEmail.includes('.af.') || osbpName.includes('air force')) {
        osbpSubAgency = 'Department of the Air Force';
      } else if (osbpEmail.includes('epa.gov') || osbpName.includes('epa')) {
        osbpSubAgency = 'Environmental Protection Agency';
      } else if (osbpEmail.includes('va.gov') || osbpName.includes('veterans')) {
        osbpSubAgency = 'Department of Veterans Affairs';
      } else if (osbpEmail.includes('gsa.gov') || osbpName.includes('general services')) {
        osbpSubAgency = 'General Services Administration';
      } else if (osbpEmail.includes('dhs.gov') || osbpName.includes('homeland')) {
        osbpSubAgency = 'Department of Homeland Security';
      } else if (osbpEmail.includes('doj.gov') || osbpName.includes('justice')) {
        osbpSubAgency = 'Department of Justice';
      } else if (osbpEmail.includes('commerce.gov') || osbpName.includes('commerce')) {
        osbpSubAgency = 'Department of Commerce';
      } else if (osbpEmail.includes('interior.gov') || osbpName.includes('interior')) {
        osbpSubAgency = 'Department of the Interior';
      }

      uniqueOSBPs.set(email, {
        osbp: agency.osbp,
        subAgency: osbpSubAgency,
        parentAgency: agency.parentAgency,
        website: agency.website,
        forecastUrl: agency.forecastUrl,
        samForecastUrl: agency.samForecastUrl,
        command: agency.command,
        offices: [],
      });
    }

    // Add this office to the list
    const entry = uniqueOSBPs.get(email)!;
    entry.offices.push({
      name: agency.contractingOffice || agency.name,
      spending: agency.spending || 0,
      contractCount: agency.contractCount || 0,
    });
  });

  // Convert to array and sort by total spending across offices
  const osbpList = Array.from(uniqueOSBPs.values())
    .map(entry => ({
      ...entry,
      totalSpending: entry.offices.reduce((sum, o) => sum + o.spending, 0),
      totalContracts: entry.offices.reduce((sum, o) => sum + o.contractCount, 0),
    }))
    .sort((a, b) => b.totalSpending - a.totalSpending);

  // Group by subAgency for display
  const groupedBySubAgency = osbpList.reduce((acc: Record<string, typeof osbpList>, entry) => {
    const key = entry.subAgency || entry.parentAgency || 'Other';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(entry);
    return acc;
  }, {});

  const subAgencies = Object.keys(groupedBySubAgency).sort();
  const totalContacts = osbpList.length;
  const totalOffices = osbpList.reduce((sum, e) => sum + e.offices.length, 0);

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6">
        <h3 className="text-xl font-bold text-blue-300 mb-4">Office of Small Business Programs (OSBP) Contacts</h3>
        <p className="text-blue-400 mb-4">
          Direct contacts for small business programs at your selected agencies. These offices help small businesses
          navigate federal contracting and can provide guidance on upcoming opportunities.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-blue-400">Unique OSBP Contacts</p>
            <p className="text-2xl font-bold text-blue-300">{totalContacts}</p>
          </div>
          <div>
            <p className="text-sm text-blue-400">Sub-Agencies / Branches</p>
            <p className="text-2xl font-bold text-blue-300">{subAgencies.length}</p>
          </div>
          <div>
            <p className="text-sm text-blue-400">Contracting Offices Covered</p>
            <p className="text-2xl font-bold text-blue-300">{totalOffices}</p>
          </div>
        </div>
      </div>

      {/* OSBP Contacts by Sub-Agency */}
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">OSBP Contacts by Sub-Agency</h3>

        {totalContacts === 0 ? (
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-8 text-center">
            <p className="text-slate-400">No OSBP contact information available for the selected agencies.</p>
            <p className="text-sm text-slate-500 mt-2">
              Try searching for DoD commands or major civilian agencies to find OSBP contacts.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {subAgencies.map((subAgencyName, subIdx) => {
              const entries = groupedBySubAgency[subAgencyName];
              const totalAgencySpending = entries.reduce((sum, e) => sum + e.totalSpending, 0);

              return (
                <div key={subIdx} className="border border-slate-700 rounded-lg overflow-hidden">
                  {/* Sub-Agency Header */}
                  <div className="bg-slate-700/50 px-4 py-3 border-b border-slate-700">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-slate-100">{subAgencyName}</h4>
                      <div className="flex gap-4 text-sm text-slate-400">
                        <span>{entries.length} OSBP contact{entries.length !== 1 ? 's' : ''}</span>
                        <span>{formatCurrency(totalAgencySpending)} total spending</span>
                      </div>
                    </div>
                  </div>

                  {/* OSBP Contacts for this sub-agency */}
                  <div className="divide-y divide-slate-700">
                    {entries.map((entry, idx: number) => (
                      <div key={idx} className="p-4 hover:bg-slate-700/50">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-semibold text-slate-100">
                              {entry.command || entry.osbp?.name || entry.subAgency}
                            </p>
                            {entry.osbp?.name && entry.command && (
                              <p className="text-sm text-slate-400">{entry.osbp.name}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {entry.website && (
                              <a
                                href={entry.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-sm"
                              >
                                🌐 Website
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          {entry.osbp?.director && (
                            <div className="flex items-center">
                              <span className="text-slate-500 w-20">Director:</span>
                              <span className="font-medium text-slate-200">{entry.osbp.director}</span>
                            </div>
                          )}
                          {entry.osbp?.phone && (
                            <div className="flex items-center">
                              <span className="text-slate-500 w-20">Phone:</span>
                              <a href={`tel:${entry.osbp.phone}`} className="font-medium text-blue-400 hover:text-blue-300">
                                {entry.osbp.phone}
                              </a>
                            </div>
                          )}
                          {entry.osbp?.email && (
                            <div className="flex items-center">
                              <span className="text-slate-500 w-20">Email:</span>
                              <a href={`mailto:${entry.osbp.email}`} className="font-medium text-blue-400 hover:text-blue-300">
                                {entry.osbp.email}
                              </a>
                            </div>
                          )}
                          {entry.osbp?.address && (
                            <div className="flex items-start">
                              <span className="text-slate-500 w-20">Address:</span>
                              <span className="text-slate-300">{entry.osbp.address}</span>
                            </div>
                          )}
                        </div>

                        {/* Contracting Offices Covered */}
                        {entry.offices.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-700">
                            <p className="text-xs text-slate-500 mb-2">
                              Covers {entry.offices.length} contracting office{entry.offices.length !== 1 ? 's' : ''}
                              ({formatCurrency(entry.totalSpending)} spending, {entry.totalContracts} contracts):
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {entry.offices.slice(0, 10).map((office, oIdx) => (
                                <span
                                  key={oIdx}
                                  className="text-xs px-2 py-1 bg-slate-700 text-slate-300 rounded border border-slate-600"
                                  title={`${formatCurrency(office.spending)} - ${office.contractCount} contracts`}
                                >
                                  {office.name.length > 40 ? office.name.substring(0, 40) + '...' : office.name}
                                </span>
                              ))}
                              {entry.offices.length > 10 && (
                                <span className="text-xs px-2 py-1 bg-slate-600 text-slate-400 rounded border border-slate-500">
                                  +{entry.offices.length - 10} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Forecast URLs */}
                        {(entry.forecastUrl || entry.samForecastUrl) && (
                          <div className="mt-3 pt-3 border-t border-slate-700 flex gap-3">
                            {entry.forecastUrl && (
                              <a
                                href={entry.forecastUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full hover:bg-emerald-500/30 border border-emerald-500/30"
                              >
                                📋 Agency Forecast
                              </a>
                            )}
                            {entry.samForecastUrl && (
                              <a
                                href={entry.samForecastUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs px-3 py-1 bg-purple-500/20 text-purple-400 rounded-full hover:bg-purple-500/30 border border-purple-500/30"
                              >
                                🔍 SAM.gov Search
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tips for Contacting OSBP */}
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-6">
        <h3 className="text-lg font-bold text-emerald-300 mb-3">Tips for Contacting OSBP Offices</h3>
        <ul className="space-y-2">
          <li className="flex items-start">
            <span className="text-emerald-400 mr-2">✓</span>
            <span className="text-emerald-200">Introduce your company and specific capabilities relevant to the agency&apos;s mission</span>
          </li>
          <li className="flex items-start">
            <span className="text-emerald-400 mr-2">✓</span>
            <span className="text-emerald-200">Ask about upcoming vendor outreach events and industry days</span>
          </li>
          <li className="flex items-start">
            <span className="text-emerald-400 mr-2">✓</span>
            <span className="text-emerald-200">Request information about subcontracting opportunities with prime contractors</span>
          </li>
          <li className="flex items-start">
            <span className="text-emerald-400 mr-2">✓</span>
            <span className="text-emerald-200">Inquire about mentor-protégé programs and set-aside opportunities</span>
          </li>
          <li className="flex items-start">
            <span className="text-emerald-400 mr-2">✓</span>
            <span className="text-emerald-200">Ask about the agency&apos;s procurement forecast for your NAICS code</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function DecemberSpendReport({ data, inputs }: { data: any; inputs: CoreInputs }) {
  // State for combined hit list (curated + dynamic from USAspending)
  const [hitListOpps, setHitListOpps] = useState<HitListOpportunity[]>([]);
  const [loadingHitList, setLoadingHitList] = useState(true);
  const hitListStats = getHitListStats();

  // Fetch combined hit list on mount
  useEffect(() => {
    async function loadHitList() {
      setLoadingHitList(true);
      const combined = await getCombinedHitList(inputs);
      setHitListOpps(combined);
      setLoadingHitList(false);
    }
    loadHitList();
  }, [inputs]);

  return (
    <div className="space-y-6">
      {/* Premium badge */}
      <div className="flex items-center justify-between">
        <PremiumExclusiveBadge />
        <span className="text-slate-500 text-sm">Full access to similar awards intelligence</span>
      </div>

      {/* Executive Summary */}
      <div className="bg-gradient-to-br from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-xl font-bold text-amber-300 mb-4 flex items-center gap-2">
          <span>📊</span> Executive Summary
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-sm text-amber-400">Total Q4 Spend</p>
            <p className="text-2xl font-bold text-amber-300">
              {formatCurrency(data.summary.totalQ4Spend)}
            </p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-sm text-amber-400">Urgent Opportunities</p>
            <p className="text-2xl font-bold text-amber-300">{data.summary.urgentOpportunities}</p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-sm text-amber-400">Low Competition Contracts</p>
            <p className="text-2xl font-bold text-amber-300">{hitListOpps.length}</p>
          </div>
        </div>
      </div>

      {/* December Hit List - Low Competition Contracts */}
      <div className="bg-emerald-500/10 border-2 border-emerald-500/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-emerald-300">🎯 December Hit List - Low Competition Contracts</h3>
          <span className="px-3 py-1 bg-emerald-500 text-white text-sm font-bold rounded-full">
            {hitListOpps.length} TOTAL
          </span>
        </div>
        <p className="text-sm text-emerald-400 mb-4">
          Curated + dynamic opportunities from your {inputs.naicsCode ? `NAICS code (${inputs.naicsCode})` : inputs.pscCode ? `PSC code (${inputs.pscCode})` : 'search criteria'} with higher win probability
        </p>

        {loadingHitList ? (
          <div className="flex items-center justify-center py-8">
            <svg className="animate-spin h-8 w-8 text-emerald-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="ml-3 text-emerald-400 font-semibold">Finding more opportunities from USAspending.gov...</span>
          </div>
        ) : hitListOpps.length > 0 ? (
          <div className="space-y-3">
            {hitListOpps.map((opp: HitListOpportunity, idx: number) => {
              const daysUntil = getDaysUntilDeadline(opp.deadline);
              const urgencyBadge = getUrgencyBadge(opp);
              const actionStrategy = getHitListActionStrategy(opp, inputs);

              const isCurated = opp.source === 'curated';
              const isDynamic = opp.source === 'usaspending';

              return (
                <div
                  key={opp.id}
                  className="bg-slate-800 border border-emerald-500/30 rounded-lg p-4 hover:border-emerald-500/50 transition-all card-hover"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {isCurated && (
                          <span className="px-2 py-1 bg-blue-600 text-white text-xs font-bold rounded">
                            CURATED
                          </span>
                        )}
                        {isDynamic && (
                          <span className="px-2 py-1 bg-purple-600 text-white text-xs font-bold rounded">
                            SIMILAR AWARD
                          </span>
                        )}
                        <span className={`px-3 py-1 text-xs font-bold rounded ${
                          urgencyBadge.color === 'red'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : urgencyBadge.color === 'orange'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}>
                          {urgencyBadge.text}
                        </span>
                        {daysUntil !== null && daysUntil > 0 && (
                          <span className="text-xs text-slate-400">
                            {daysUntil} days left
                          </span>
                        )}
                        {opp.winProbability && (
                          <span className={`px-2 py-1 text-xs font-bold rounded ${
                            opp.winProbability === 'high'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : opp.winProbability === 'medium'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-slate-700 text-slate-400 border border-slate-600'
                          }`}>
                            {opp.winProbability.toUpperCase()} WIN PROB
                          </span>
                        )}
                      </div>
                      <h4 className="font-bold text-slate-100 text-base mb-1">{opp.title}</h4>
                      <p className="text-sm text-slate-400 mb-2">
                        {opp.agency && <><strong className="text-slate-300">Agency:</strong> {opp.agency} | </>}
                        <strong className="text-slate-300">NAICS:</strong> {opp.naics}
                        {opp.amount && <> | <strong className="text-slate-300">Value:</strong> ${(opp.amount / 1000).toFixed(0)}K</>}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {isCurated && opp.deadline && (
                      <p className="text-sm text-slate-300">
                        <strong>Deadline:</strong> {opp.deadline}
                      </p>
                    )}
                    {isDynamic && opp.awardDate && (
                      <p className="text-sm text-slate-300">
                        <strong>Award Date:</strong> {new Date(opp.awardDate).toLocaleDateString()}
                      </p>
                    )}
                    {opp.setAside && opp.setAside !== 'Unrestricted' && (
                      <p className="text-sm text-emerald-400">
                        <strong>Set-Aside:</strong> {opp.setAside}
                      </p>
                    )}
                    {opp.description && (
                      <p className="text-sm text-slate-300">
                        <strong>Description:</strong> {opp.description}
                      </p>
                    )}
                    {opp.poc && (
                      <p className="text-sm text-blue-400">
                        <strong>POC:</strong> {opp.poc}
                      </p>
                    )}
                    {isCurated && (
                      <p className="text-sm text-emerald-300 bg-emerald-500/10 p-2 rounded border border-emerald-500/30">
                        <strong>Action Strategy:</strong> {actionStrategy}
                      </p>
                    )}
                    {isDynamic && (
                      <p className="text-sm text-purple-300 bg-purple-500/10 p-2 rounded border border-purple-500/30">
                        <strong>Why This Matters:</strong> Similar contract was awarded in your NAICS - contact this office to present capabilities for upcoming opportunities
                      </p>
                    )}
                    <a
                      href={isCurated
                        ? `https://sam.gov/search/?index=opp&page=1&sort=-modifiedDate&sfm%5Bstatus%5D%5Bis_active%5D=true&keywords=${encodeURIComponent(opp.noticeId || opp.title)}`
                        : opp.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-sm text-blue-400 hover:text-blue-300 font-semibold"
                    >
                      📄 {isCurated ? `Search SAM.gov for ${opp.noticeId || 'this opportunity'}` : 'View Award Details on USAspending.gov'} →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400">
            <p>No hit list opportunities found for your criteria.</p>
            <p className="text-sm mt-2">Try adjusting your NAICS code or business type.</p>
          </div>
        )}
      </div>

      {/* Similar Awards */}
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">📊 Similar Awards in Your NAICS</h3>
        <div className="space-y-3">
          {data.opportunities.map((opp: any, idx: number) => (
            <div key={idx} className="border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-slate-100">{opp.agency}</p>
                  {opp.program && <p className="text-sm text-slate-400">{opp.program}</p>}
                </div>
                <div className="text-right">
                  <p className="font-semibold text-emerald-400">
                    {formatCurrency(opp.estimatedQ4Spend)}
                  </p>
                  <span className={`px-2 py-1 text-xs font-semibold rounded ${
                    opp.urgencyLevel === 'high'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : opp.urgencyLevel === 'medium'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {opp.urgencyLevel.toUpperCase()}
                  </span>
                </div>
              </div>
              <p className="text-sm text-blue-400 mb-2"><strong>Quick Win Strategy:</strong> {opp.quickWinStrategy}</p>
              {opp.primeContractor && (
                <p className="text-sm text-slate-300 mb-1"><strong>Prime:</strong> {opp.primeContractor}</p>
              )}
              {opp.hotNaics && (
                <p className="text-sm text-slate-300 mb-1"><strong>Hot NAICS:</strong> {opp.hotNaics}</p>
              )}
              {opp.sbloContact && (
                <p className="text-sm text-emerald-400">
                  <strong>Office of Small Business Contact:</strong> {opp.sbloContact.name} - {opp.sbloContact.email}
                </p>
              )}
              <a
                href={`https://sam.gov/search/?index=opp&page=1&sort=-modifiedDate&sfm%5Bstatus%5D%5Bis_active%5D=true&keywords=${encodeURIComponent(opp.agency || '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-sm text-blue-400 hover:text-blue-300 font-semibold"
              >
                🔍 Search SAM.gov for {opp.agency} opportunities →
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {hitListOpps.length > 0 && (
            <>
              <li className="flex items-start">
                <span className="text-emerald-400 mr-2">✓</span>
                <span className="text-slate-300">
                  <strong className="text-emerald-400">PRIORITY:</strong> Focus on {hitListOpps.filter((o: HitListOpportunity) => o.isUrgent).length} urgent hit list opportunities with imminent deadlines
                </span>
              </li>
              <li className="flex items-start">
                <span className="text-emerald-400 mr-2">✓</span>
                <span className="text-slate-300">
                  Hit list contracts have lower competition - prioritize these for higher win probability
                </span>
              </li>
            </>
          )}
          {data.recommendations.map((rec: string, idx: number) => (
            <li key={idx} className="flex items-start">
              <span className="text-amber-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TribalReport({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      {/* Premium badge */}
      <div className="flex items-center justify-between">
        <PremiumExclusiveBadge />
        <span className="text-slate-500 text-sm">Full access to tribal contracting intelligence</span>
      </div>

      <div className="bg-gradient-to-br from-amber-500/10 via-indigo-500/10 to-amber-500/10 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-xl font-bold text-amber-300 mb-4 flex items-center gap-2">
          <span>🏛️</span> Executive Summary
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-sm text-indigo-400">Total Opportunities</p>
            <p className="text-2xl font-bold text-indigo-300">{data.summary.totalOpportunities}</p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3">
            <p className="text-sm text-indigo-400">Estimated Value</p>
            <p className="text-2xl font-bold text-indigo-300">
              ${(data.summary.totalValue / 1000000).toFixed(1)}M
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">Suggested Tribal Businesses</h3>
        <div className="space-y-3">
          {data.suggestedTribes.map((tribe: any, idx: number) => (
            <div key={idx} className="border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50">
              <div className="flex justify-between items-start mb-2">
                <p className="font-semibold text-slate-100 text-lg">{tribe.name}</p>
                <p className="text-sm text-slate-400">{tribe.region}</p>
              </div>
              {tribe.capabilities && tribe.capabilities.length > 0 && (
                <p className="text-sm text-slate-300 mb-2">
                  <strong>Capabilities:</strong> {tribe.capabilities.join(', ')}
                </p>
              )}
              {tribe.certifications && tribe.certifications.length > 0 && (
                <p className="text-sm text-emerald-400 mb-2">
                  <strong>Certifications:</strong> {tribe.certifications.join(', ')}
                </p>
              )}
              {tribe.naicsCategories && tribe.naicsCategories.length > 0 && (
                <p className="text-sm text-slate-300 mb-2">
                  <strong>NAICS:</strong> {tribe.naicsCategories.join(', ')}
                </p>
              )}
              {tribe.contactInfo && (
                <p className="text-sm text-blue-400">
                  <strong>Contact:</strong> {tribe.contactInfo.name} - {tribe.contactInfo.email}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {data.recommendedAgencies && data.recommendedAgencies.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-slate-100 mb-4">Recommended Agencies</h3>
          <div className="flex flex-wrap gap-2">
            {data.recommendedAgencies.map((agency: string, idx: number) => (
              <span key={idx} className="px-3 py-1 bg-indigo-500/20 text-indigo-400 rounded-full text-sm border border-indigo-500/30">
                {agency}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {data.recommendations.map((rec: string, idx: number) => (
            <li key={idx} className="flex items-start">
              <span className="text-indigo-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PrimesReport({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-6">
        <h3 className="text-xl font-bold text-cyan-300 mb-4">Executive Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-cyan-400">Suggested Primes</p>
            <p className="text-2xl font-bold text-cyan-300">{data.summary.totalPrimes}</p>
          </div>
          <div>
            <p className="text-sm text-cyan-400">Other Agencies</p>
            <p className="text-2xl font-bold text-cyan-300">{data.summary.totalOtherAgencies}</p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-4">Prime Contractors in Your Industry</h3>
        <div className="space-y-3">
          {data.suggestedPrimes.map((prime: any, idx: number) => (
            <div key={idx} className="border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50">
              <div className="flex justify-between items-start mb-2">
                <p className="font-semibold text-slate-100 text-lg">{prime.name}</p>
                <span className={`px-2 py-1 text-xs font-semibold rounded ${
                  prime.smallBusinessLevel === 'high'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : prime.smallBusinessLevel === 'medium'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-slate-700 text-slate-400 border border-slate-600'
                }`}>
                  {prime.smallBusinessLevel?.toUpperCase() || 'N/A'}
                </span>
              </div>
              <p className="text-sm text-slate-300 mb-2"><strong>Reason:</strong> {prime.reason}</p>
              {prime.subcontractingOpportunities && prime.subcontractingOpportunities.length > 0 && (
                <p className="text-sm text-blue-400 mb-2">
                  <strong>Opportunities:</strong> {prime.subcontractingOpportunities.join(', ')}
                </p>
              )}
              {prime.contractTypes && prime.contractTypes.length > 0 && (
                <p className="text-sm text-slate-300">
                  <strong>Contract Types:</strong> {prime.contractTypes.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {data.otherAgencies && data.otherAgencies.length > 0 && (
        <div>
          <h3 className="text-lg font-bold text-slate-100 mb-4">Other Agencies to Consider</h3>
          <div className="space-y-3">
            {data.otherAgencies.map((agency: any, idx: number) => (
              <div key={idx} className="border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50">
                <p className="font-semibold text-slate-100 mb-2">{agency.name}</p>
                <p className="text-sm text-slate-300 mb-2"><strong>Reason:</strong> {agency.reason}</p>
                {agency.matchingPainPoints && agency.matchingPainPoints.length > 0 && (
                  <div className="text-sm text-blue-400 mb-2">
                    <strong>Matching Pain Points:</strong>
                    <ul className="list-disc list-inside mt-1">
                      {agency.matchingPainPoints.map((pp: string, ppIdx: number) => (
                        <li key={ppIdx}>{pp}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm text-emerald-400"><strong>Relevance:</strong> {agency.relevance}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6">
        <h3 className="text-lg font-bold text-slate-100 mb-3">Recommendations</h3>
        <ul className="space-y-2">
          {data.recommendations.map((rec: string, idx: number) => (
            <li key={idx} className="flex items-start">
              <span className="text-cyan-400 mr-2">✓</span>
              <span className="text-slate-300">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Locked Section Overlay Component for Premium-only sections
function LockedSectionOverlay({ sectionName, onUpgrade }: { sectionName: string; onUpgrade: () => void }) {
  // Get section-specific details
  const sectionDetails: Record<string, { icon: string; benefit: string; dataPreview: string }> = {
    'Subcontracting Opportunities': {
      icon: '🔗',
      benefit: 'Find prime contractors actively seeking small business partners',
      dataPreview: '50+ prime contractors with SBLO contacts'
    },
    'IDV Contracts': {
      icon: '📋',
      benefit: 'Discover BPAs, IDIQs, and GWACs you can compete on',
      dataPreview: '100+ contract vehicles in your NAICS'
    },
    'Similar Awards': {
      icon: '📊',
      benefit: 'See past contracts in your NAICS to identify patterns',
      dataPreview: '200+ historical awards analyzed'
    },
    'Tribal Contracting': {
      icon: '🏛️',
      benefit: 'Find tribal partnerships and 8(a) teaming opportunities',
      dataPreview: '25+ tribal businesses in your region'
    }
  };

  const details = sectionDetails[sectionName] || {
    icon: '🔒',
    benefit: 'Get deeper insights into your target market',
    dataPreview: 'Premium intelligence data'
  };

  return (
    <div className="relative min-h-[500px] bg-slate-900 rounded-2xl overflow-hidden border border-slate-700/50">
      {/* Blurred background preview with more realistic data shapes */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800">
        <div className="p-8 blur-[6px] opacity-40">
          {/* Fake header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 bg-slate-600 rounded-lg"></div>
            <div className="h-6 w-48 bg-slate-600 rounded"></div>
          </div>
          {/* Fake stats row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-slate-700/50 rounded-xl"></div>
            ))}
          </div>
          {/* Fake table rows */}
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-16 bg-slate-700/30 rounded-lg flex items-center gap-4 px-4">
                <div className="h-8 w-8 bg-slate-600 rounded"></div>
                <div className="flex-1 h-4 bg-slate-600 rounded"></div>
                <div className="w-24 h-6 bg-slate-600 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/90 to-slate-900/70" />

      {/* Lock content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center p-8 max-w-lg">
          {/* Premium badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-full mb-6">
            <span className="text-amber-400 text-sm font-bold">PREMIUM EXCLUSIVE</span>
            <span className="text-lg">👑</span>
          </div>

          {/* Icon */}
          <div className="w-20 h-20 bg-gradient-to-br from-amber-500/30 to-orange-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-amber-500/30 glow-amber">
            <span className="text-4xl">{details.icon}</span>
          </div>

          {/* Title */}
          <h3 className="text-2xl font-bold text-white mb-2">
            Upgrade to Unlock {sectionName}
          </h3>

          {/* Benefit */}
          <p className="text-slate-300 mb-4">
            {details.benefit}
          </p>

          {/* Data preview teaser */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/80 border border-slate-700 rounded-lg mb-6">
            <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-slate-300 text-sm">{details.dataPreview}</span>
          </div>

          {/* CTA */}
          <button
            onClick={onUpgrade}
            className="w-full max-w-xs mx-auto px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold rounded-xl transition-all transform hover:scale-[1.02] glow-amber text-lg"
          >
            Unlock Premium - $497 Lifetime
          </button>

          {/* Feature list */}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {['IDV Contracts', 'Similar Awards', 'Subcontracting', 'Tribal'].map((feature) => (
              <span
                key={feature}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  feature === sectionName.split(' ')[0]
                    ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {feature === sectionName.split(' ')[0] ? '→ ' : ''}{feature}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Upgrade Modal Component
function UpgradeModal({ isOpen, onClose, currentTier }: { isOpen: boolean; onClose: () => void; currentTier: MarketAssassinTier }) {
  if (!isOpen) return null;

  const premiumFeatures = [
    { name: 'IDV Contracts', description: 'BPAs, IDIQs, GWACs and contract vehicles you can compete on', icon: '📋' },
    { name: 'Similar Awards', description: 'Past contracts in your NAICS code to identify opportunities', icon: '📊' },
    { name: 'Subcontracting Opportunities', description: 'Prime contractors actively seeking small business partners', icon: '🔗' },
    { name: 'Tribal Contracting', description: 'Tribal partnerships and 8(a) teaming opportunities', icon: '🏛️' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-[fadeIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'fadeIn 0.2s ease-out, slideUp 0.3s ease-out' }}
      >
        {/* Header with animated gradient */}
        <div className="relative bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600 px-6 py-8 text-center overflow-hidden">
          <div className="absolute inset-0 animate-shimmer" />
          <div className="relative">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-4 glow-amber">
              <span className="text-3xl">👑</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Unlock Premium Intelligence</h2>
            <p className="text-amber-100/90">Get the complete Federal Market Assassin experience</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Current plan indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="text-slate-400 text-sm">You have:</span>
            <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-sm font-semibold rounded-full border border-blue-500/30">
              4 Standard Reports
            </span>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold text-slate-100 mb-4 text-center">Upgrade to get 4 more powerful reports:</h3>
            <ul className="space-y-3">
              {premiumFeatures.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:border-amber-500/30 transition-colors">
                  <span className="text-2xl flex-shrink-0">{feature.icon}</span>
                  <div>
                    <span className="font-medium text-slate-100">{feature.name}</span>
                    <p className="text-sm text-slate-400">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Pricing */}
          <div className="bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Premium Upgrade</p>
                <p className="text-3xl font-bold text-slate-100">$200</p>
                <p className="text-xs text-slate-400">One-time payment</p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 text-emerald-400">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm font-semibold">Unlimited Usage</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">vs $297/mo standard</p>
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="space-y-3">
            <a
              href="https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f"
              className="block w-full px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold rounded-xl transition-all text-center text-lg glow-amber hover:scale-[1.02]"
            >
              Upgrade to Premium →
            </a>
            <button
              onClick={onClose}
              className="block w-full px-6 py-3 text-slate-400 hover:text-slate-200 font-medium transition text-center rounded-lg hover:bg-slate-800/50"
            >
              Continue with Standard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
