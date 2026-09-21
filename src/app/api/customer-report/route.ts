import { NextRequest, NextResponse } from 'next/server';
import { CoreInputs, ComprehensiveReport } from '@/types/federal-market-assassin';

// This endpoint is called by Google Apps Script after a customer fills out the form
// It finds agencies, generates the full report, and returns HTML for email delivery

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Extract form data (from Google Form via Apps Script)
    const {
      email,
      companyName,
      businessType,
      naicsCode,
      zipCode,
      veteranStatus,
      serviceDisabled,
      apiKey, // Optional: for securing the endpoint
    } = body;

    // Optional: Validate API key for security
    const expectedApiKey = process.env.CUSTOMER_REPORT_API_KEY;
    if (expectedApiKey && apiKey !== expectedApiKey) {
      return NextResponse.json(
        { success: false, error: 'Invalid API key' },
        { status: 401 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    console.log(`📧 Generating customer report for: ${email}`);
    console.log(`   Company: ${companyName || 'Not provided'}`);
    console.log(`   Business Type: ${businessType}`);
    console.log(`   NAICS: ${naicsCode}`);
    console.log(`   ZIP: ${zipCode}`);

    // Build core inputs for the search
    const coreInputs: CoreInputs = {
      businessType: businessType || 'Small Business',
      naicsCode: naicsCode || '',
      zipCode: zipCode || '',
      veteranStatus: serviceDisabled === 'Yes'
        ? 'Service Disabled Veteran'
        : veteranStatus === 'Yes'
          ? 'Veteran Owned'
          : 'Not Applicable',
      companyName: companyName || '',
    };

    // Step 1: Find agencies using the existing endpoint logic
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
                    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` :
                    'http://localhost:3000';

    const findAgenciesResponse = await fetch(`${baseUrl}/api/usaspending/find-agencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coreInputs),
    });

    if (!findAgenciesResponse.ok) {
      throw new Error('Failed to find agencies');
    }

    const agencyData = await findAgenciesResponse.json();

    if (!agencyData.success || !agencyData.agencies || agencyData.agencies.length === 0) {
      // Return a "no results" report
      return NextResponse.json({
        success: true,
        email,
        reportHtml: generateNoResultsHtml(coreInputs, companyName),
        message: 'No agencies found for the specified criteria',
      });
    }

    // Select top 10 agencies automatically
    const topAgencies = agencyData.agencies.slice(0, 10);
    const selectedAgencyIds = topAgencies.map((a: any) => a.id);

    console.log(`   Found ${agencyData.agencies.length} agencies, selecting top ${topAgencies.length}`);

    // Step 2: Generate comprehensive report
    const generateReportResponse = await fetch(`${baseUrl}/api/reports/generate-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: coreInputs,
        selectedAgencies: selectedAgencyIds,
        selectedAgencyData: topAgencies,
      }),
    });

    if (!generateReportResponse.ok) {
      throw new Error('Failed to generate report');
    }

    const reportData = await generateReportResponse.json();

    if (!reportData.success || !reportData.report) {
      throw new Error('Report generation returned no data');
    }

    // Step 3: Generate HTML email content
    const reportHtml = generateReportHtml(reportData.report, coreInputs, companyName, email);

    console.log(`✅ Report generated successfully for ${email}`);

    return NextResponse.json({
      success: true,
      email,
      companyName,
      reportHtml,
      agencyCount: topAgencies.length,
      message: 'Report generated successfully',
    });

  } catch (error) {
    console.error('Error generating customer report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}

function generateNoResultsHtml(inputs: CoreInputs, companyName?: string): string {
  const date = new Date().toLocaleDateString();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Federal Market Assassin Report | GovCon Giants</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px; margin: 0 auto; padding: 20px; background: #f8fafc; }
    .container { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .brand { text-align: center; margin-bottom: 30px; }
    .brand-govcon { font-size: 32px; font-weight: 700; color: #1d4ed8; }
    .brand-giants { font-size: 32px; font-weight: 700; color: #f59e0b; }
    h1 { color: #1e40af; text-align: center; margin-bottom: 10px; }
    .subtitle { text-align: center; color: #64748b; margin-bottom: 30px; }
    .alert { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .alert h3 { color: #92400e; margin-top: 0; }
    .suggestions { background: #eff6ff; border-radius: 8px; padding: 20px; margin-top: 20px; }
    .suggestions h3 { color: #1e40af; margin-top: 0; }
    .suggestions ul { margin: 0; padding-left: 20px; }
    .suggestions li { margin-bottom: 10px; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
    </div>
    <h1>Federal Market Assassin Report</h1>
    <p class="subtitle">Generated on ${date}${companyName ? ` for ${companyName}` : ''}</p>

    <div class="alert">
      <h3>No Matching Agencies Found</h3>
      <p>We couldn't find government agencies matching your specific criteria. This could mean:</p>
      <ul>
        <li>Your NAICS code may be very specialized</li>
        <li>Your geographic area may have limited opportunities</li>
        <li>Your set-aside category may have fewer contracts in this industry</li>
      </ul>
    </div>

    <div class="suggestions">
      <h3>Recommendations</h3>
      <ul>
        <li><strong>Broaden your NAICS search:</strong> Try using a 2 or 3-digit NAICS prefix instead of a specific 6-digit code</li>
        <li><strong>Expand your geographic reach:</strong> Consider removing the ZIP code filter to see nationwide opportunities</li>
        <li><strong>Check related industries:</strong> Look for adjacent NAICS codes that may use similar services</li>
        <li><strong>Contact us:</strong> Reach out to GovCon Giants for personalized assistance with your market analysis</li>
      </ul>
    </div>

    <div class="footer">
      <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
      <p>Federal Market Assassin - Your Strategic Advantage in Government Contracting</p>
      <p>&copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

function generateReportHtml(
  reports: ComprehensiveReport,
  inputs: CoreInputs,
  companyName?: string,
  customerEmail?: string
): string {
  const date = new Date().toLocaleDateString();
  const dateIso = new Date().toISOString();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Federal Market Assassin - Comprehensive Report - ${date} | GovCon Giants</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f8fafc; }
    .container { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .brand { text-align: center; margin-bottom: 20px; }
    .brand-govcon { font-size: 28px; font-weight: 700; color: #1d4ed8; }
    .brand-giants { font-size: 28px; font-weight: 700; color: #f59e0b; }
    h1 { color: #1e40af; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; text-align: center; }
    h2 { color: #1e3a8a; margin-top: 40px; border-bottom: 2px solid #93c5fd; padding-bottom: 8px; }
    h3 { color: #1e40af; margin-top: 20px; }
    .meta { background: #f1f5f9; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .meta-item { display: inline-block; background: #e2e8f0; padding: 5px 12px; border-radius: 20px; margin: 3px; font-size: 14px; }
    .highlight { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; color: #1e3a8a; }
    tr:hover { background: #f8fafc; }
    .amount { font-weight: 600; color: #059669; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 10px 0; }
    .card-title { font-weight: 600; color: #1e3a8a; margin-bottom: 8px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-purple { background: #f3e8ff; color: #7c3aed; }
    .badge-amber { background: #fef3c7; color: #92400e; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
    .stat-card { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 20px; border-radius: 12px; text-align: center; border: 1px solid #bfdbfe; }
    .stat-value { font-size: 28px; font-weight: 700; color: #1e40af; }
    .stat-label { font-size: 12px; color: #64748b; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.5px; }
    .section-intro { background: #eff6ff; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3b82f6; }
    .recommendations { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin-top: 20px; }
    .recommendations h4 { color: #166534; margin-top: 0; margin-bottom: 10px; }
    .recommendations ul { margin: 0; padding-left: 20px; }
    .recommendations li { margin-bottom: 8px; color: #15803d; }
    .contact-card { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 10px 0; }
    .contact-card strong { color: #92400e; }
    .footer { text-align: center; margin-top: 40px; padding-top: 30px; border-top: 2px solid #e2e8f0; }
    .footer .brand-govcon { font-size: 20px; }
    .footer .brand-giants { font-size: 20px; }
    .footer p { color: #64748b; font-size: 12px; margin: 5px 0; }
    @media print {
      body { background: white; }
      .container { box-shadow: none; }
      h2 { page-break-before: always; }
      h2:first-of-type { page-break-before: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
    </div>
    <h1>Federal Market Assassin Report</h1>

    <div class="meta">
      <p><strong>Generated:</strong> ${date}${companyName ? ` | <strong>Company:</strong> ${companyName}` : ''}</p>
      <p><strong>Search Criteria:</strong></p>
      <div>
        ${inputs.businessType ? `<span class="meta-item">Business Type: ${inputs.businessType}</span>` : ''}
        ${inputs.naicsCode ? `<span class="meta-item">NAICS: ${inputs.naicsCode}</span>` : ''}
        ${inputs.zipCode ? `<span class="meta-item">ZIP: ${inputs.zipCode}</span>` : ''}
        ${inputs.veteranStatus && inputs.veteranStatus !== 'Not Applicable' ? `<span class="meta-item">${inputs.veteranStatus}</span>` : ''}
      </div>
      <p style="margin-top: 10px;"><strong>Agencies Analyzed:</strong> ${reports.metadata.selectedAgencies.length}</p>
    </div>

    <div class="highlight">
      <strong>Your Personalized Report</strong><br>
      This comprehensive market intelligence report was generated specifically for your business profile.
      Use these insights to identify and pursue the most promising government contracting opportunities.
    </div>

    <!-- Government Buyers Report -->
    <h2>Government Buyers Report</h2>
    <div class="section-intro">Top government agencies matching your criteria, ranked by spending in your industry.</div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${reports.governmentBuyers.summary.totalAgencies}</div>
        <div class="stat-label">Total Agencies</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${(reports.governmentBuyers.summary.totalSpending / 1000000).toFixed(1)}M</div>
        <div class="stat-label">Total Spending</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${reports.governmentBuyers.summary.totalContracts}</div>
        <div class="stat-label">Total Contracts</div>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>#</th><th>Agency / Office</th><th>Parent Agency</th><th>Spending</th><th>Contracts</th></tr>
      </thead>
      <tbody>
        ${reports.governmentBuyers.agencies.slice(0, 20).map((agency: any, i: number) => `
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

    <div class="recommendations">
      <h4>Action Items</h4>
      <ul>
        ${reports.governmentBuyers.recommendations.slice(0, 4).map((rec: string) => `<li>${rec}</li>`).join('')}
      </ul>
    </div>

    <!-- Subcontracting Opportunities -->
    <h2>Subcontracting Opportunities</h2>
    <div class="section-intro">Prime contractors and Tier 2 subcontracting opportunities in your industry.</div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${reports.tier2Subcontracting.summary.totalPrimes}</div>
        <div class="stat-label">Tier 2 Contractors</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${reports.primeContractor.suggestedPrimes?.length || 0}</div>
        <div class="stat-label">Prime Contractors</div>
      </div>
    </div>

    <h3>Suggested Prime Contractors</h3>
    <table>
      <thead>
        <tr><th>Prime Contractor</th><th>Reason</th><th>Contact</th></tr>
      </thead>
      <tbody>
        ${(reports.primeContractor.suggestedPrimes || []).slice(0, 10).map((prime: any) => `
          <tr>
            <td><strong>${prime.name || 'Unknown'}</strong></td>
            <td>${prime.reason || '-'}</td>
            <td>${prime.email ? `<a href="mailto:${prime.email}">${prime.email}</a>` : (prime.sbloName || 'Contact for details')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- IDV Contracts -->
    <h2>IDV Vehicle Contracts</h2>
    <div class="section-intro">Indefinite Delivery Vehicles (IDVs) and contract vehicles matching your NAICS code.</div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${reports.idvContracts?.summary?.totalContracts || 0}</div>
        <div class="stat-label">IDV Contracts</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${((reports.idvContracts?.summary?.totalValue || 0) / 1000000).toFixed(1)}M</div>
        <div class="stat-label">Total Value</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${reports.idvContracts?.summary?.uniquePrimes || 0}</div>
        <div class="stat-label">Unique Primes</div>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Contractor</th><th>Agency</th><th>Award Amount</th></tr>
      </thead>
      <tbody>
        ${(reports.idvContracts?.contracts || []).slice(0, 15).map((contract: any) => `
          <tr>
            <td><strong>${contract.recipientName || 'N/A'}</strong></td>
            <td>${contract.agencyName || contract.agency || 'N/A'}</td>
            <td class="amount">$${(contract.awardAmount / 1000000).toFixed(2)}M</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- Agency Pain Points -->
    <h2>Agency Pain Points</h2>
    <div class="section-intro">Key challenges and needs at your target agencies - use these to position your solutions.</div>

    ${reports.agencyPainPoints.painPoints.slice(0, 10).map((pp: any) => `
      <div class="card">
        <div class="card-title">${pp.agency}</div>
        <p><strong>Challenge:</strong> ${pp.painPoint}</p>
        <p><strong>Your Positioning:</strong> ${pp.solutionPositioning}</p>
        <span class="badge ${pp.priority === 'high' ? 'badge-purple' : 'badge-blue'}">${pp.priority} priority</span>
      </div>
    `).join('')}

    <div class="recommendations">
      <h4>How to Leverage Pain Points</h4>
      <ul>
        ${reports.agencyPainPoints.recommendations.slice(0, 4).map((rec: string) => `<li>${rec}</li>`).join('')}
      </ul>
    </div>

    <!-- December Spend / Similar Awards -->
    <h2>Similar Awards in Your NAICS</h2>
    <div class="section-intro">Historical contract awards matching your industry - use these to identify buying patterns.</div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">$${(reports.decemberSpend.summary.totalQ4Spend / 1000000).toFixed(1)}M</div>
        <div class="stat-label">Total Award Value</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${reports.decemberSpend.opportunities.length}</div>
        <div class="stat-label">Similar Awards</div>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Agency</th><th>Program</th><th>Value</th><th>Urgency</th></tr>
      </thead>
      <tbody>
        ${reports.decemberSpend.opportunities.slice(0, 10).map((opp: any) => `
          <tr>
            <td><strong>${opp.agency}</strong></td>
            <td>${opp.program || '-'}</td>
            <td class="amount">$${(opp.estimatedQ4Spend / 1000000).toFixed(2)}M</td>
            <td><span class="badge ${opp.urgencyLevel === 'high' ? 'badge-amber' : 'badge-blue'}">${opp.urgencyLevel}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- Tribal Contracting -->
    ${reports.tribalContracting.suggestedTribes && reports.tribalContracting.suggestedTribes.length > 0 ? `
    <h2>Tribal Contracting Opportunities</h2>
    <div class="section-intro">8(a) certified tribal businesses for potential teaming arrangements.</div>

    <table>
      <thead>
        <tr><th>Tribal Business</th><th>Region</th><th>Certifications</th><th>Contact</th></tr>
      </thead>
      <tbody>
        ${reports.tribalContracting.suggestedTribes.slice(0, 8).map((tribe: any) => `
          <tr>
            <td><strong>${tribe.name}</strong></td>
            <td>${tribe.region || '-'}</td>
            <td>${(tribe.certifications || []).slice(0, 2).join(', ') || '-'}</td>
            <td>${tribe.contactInfo?.email ? `<a href="mailto:${tribe.contactInfo.email}">${tribe.contactInfo.email}</a>` : '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}

    <!-- Next Steps -->
    <h2>Your Next Steps</h2>
    <div class="section-intro">Actionable recommendations to help you win government contracts.</div>

    <div class="recommendations" style="background: #fef3c7; border-color: #f59e0b;">
      <h4 style="color: #92400e;">Priority Actions</h4>
      <ol style="margin: 0; padding-left: 20px;">
        <li style="margin-bottom: 12px; color: #78350f;"><strong>Contact Top Agencies:</strong> Reach out to the OSBP (Office of Small Business Programs) at your top 3 target agencies</li>
        <li style="margin-bottom: 12px; color: #78350f;"><strong>Build Prime Relationships:</strong> Contact the suggested prime contractors for subcontracting opportunities</li>
        <li style="margin-bottom: 12px; color: #78350f;"><strong>Monitor Forecasts:</strong> Set up SAM.gov alerts for your NAICS code and target agencies</li>
        <li style="margin-bottom: 12px; color: #78350f;"><strong>Prepare Your Capability Statement:</strong> Tailor it to address the pain points identified in this report</li>
        <li style="margin-bottom: 12px; color: #78350f;"><strong>Attend Industry Days:</strong> Check agency websites for upcoming industry day events</li>
      </ol>
    </div>

    <div class="footer">
      <span class="brand-govcon">GovCon</span><span class="brand-giants">Giants</span>
      <p style="margin-top: 15px;">Federal Market Assassin - Your Strategic Advantage in Government Contracting</p>
      <p>Generated: ${dateIso}</p>
      <p>&copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved. | govcongiants.com</p>
    </div>
  </div>
</body>
</html>`;
}
