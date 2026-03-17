import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

const BASE_URL = 'https://tools.govcongiants.org';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  message: string;
  responseTime?: number;
  details?: string;
}

interface HealthCheckReport {
  timestamp: string;
  environment: string;
  totalTests: number;
  passed: number;
  failed: number;
  passRate: string;
  results: TestResult[];
  criticalFailures: TestResult[];
}

// Lazy init for email transport
function getTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'hello@govconedu.com',
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

async function runTest(
  name: string,
  category: string,
  testFn: () => Promise<{ passed: boolean; message: string; details?: string }>
): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await testFn();
    return {
      name,
      category,
      passed: result.passed,
      message: result.message,
      details: result.details,
      responseTime: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      category,
      passed: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      responseTime: Date.now() - start,
    };
  }
}

// ============================================================
// TEST DEFINITIONS
// ============================================================

const tests = [
  // CRITICAL: User-facing signup flows
  {
    name: 'Alerts Signup (Free)',
    category: 'Critical Flows',
    critical: true,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/alerts/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `healthcheck-${Date.now()}@test.govcongiants.org`,
          naicsCodes: ['541511'],
          businessType: 'SDVOSB',
          source: 'free-signup',
        }),
      });
      const data = await res.json();
      return {
        passed: data.success === true,
        message: data.success ? 'Alert signup working' : `Failed: ${data.error}`,
        details: JSON.stringify(data),
      };
    },
  },
  {
    name: 'Profile API (GET)',
    category: 'Critical Flows',
    critical: true,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/profile?email=test@example.com`);
      const data = await res.json();
      return {
        passed: res.ok && data !== undefined,
        message: res.ok ? 'Profile API responding' : `HTTP ${res.status}`,
      };
    },
  },
  {
    name: 'Profile Setup Page',
    category: 'Critical Flows',
    critical: true,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/profile/setup?email=test@example.com`);
      return {
        passed: res.status === 200,
        message: res.status === 200 ? 'Page loads' : `HTTP ${res.status}`,
      };
    },
  },

  // API Health
  {
    name: 'Homepage',
    category: 'Page Health',
    critical: false,
    fn: async () => {
      const res = await fetch(BASE_URL);
      return {
        passed: res.status === 200,
        message: res.status === 200 ? 'Homepage loads' : `HTTP ${res.status}`,
      };
    },
  },
  {
    name: 'Store Page',
    category: 'Page Health',
    critical: false,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/store`);
      return {
        passed: res.status === 200,
        message: res.status === 200 ? 'Store loads' : `HTTP ${res.status}`,
      };
    },
  },
  {
    name: 'Opportunity Hunter',
    category: 'Page Health',
    critical: false,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/opportunity-hunter`);
      return {
        passed: res.status === 200,
        message: res.status === 200 ? 'OH loads' : `HTTP ${res.status}`,
      };
    },
  },
  {
    name: 'Alerts Signup Page',
    category: 'Page Health',
    critical: true,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/alerts/signup`);
      return {
        passed: res.status === 200,
        message: res.status === 200 ? 'Alerts signup loads' : `HTTP ${res.status}`,
      };
    },
  },

  // Data APIs
  {
    name: 'USASpending API Proxy',
    category: 'Data APIs',
    critical: false,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/usaspending/find-agencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naicsCode: '541511', limit: 3 }),
      });
      const data = await res.json();
      return {
        passed: res.ok && Array.isArray(data.agencies),
        message: res.ok ? `Found ${data.agencies?.length || 0} agencies` : `HTTP ${res.status}`,
      };
    },
  },
  {
    name: 'Pain Points API',
    category: 'Data APIs',
    critical: false,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/pain-points?agency=Department%20of%20Defense`);
      const data = await res.json();
      return {
        passed: res.ok && (data.painPoints?.length > 0 || data.priorities?.length > 0),
        message: res.ok ? `${data.painPoints?.length || 0} pain points` : `HTTP ${res.status}`,
      };
    },
  },
  {
    name: 'Contractors API',
    category: 'Data APIs',
    critical: false,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/contractors?limit=3`);
      const data = await res.json();
      return {
        passed: res.ok && Array.isArray(data.contractors),
        message: res.ok ? `${data.contractors?.length || 0} contractors` : `HTTP ${res.status}`,
      };
    },
  },

  // Access Control
  {
    name: 'Content Generator Access Denied',
    category: 'Access Control',
    critical: false,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/verify-content-generator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent-test@example.com' }),
      });
      const data = await res.json();
      return {
        passed: data.hasAccess === false,
        message: data.hasAccess === false ? 'Access correctly denied' : 'Should deny access',
      };
    },
  },

  // Lead Capture (third-party Beehiiv dependency - non-critical)
  {
    name: 'Lead Capture API',
    category: 'Lead Capture',
    critical: false,
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/capture-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `healthcheck-lead-${Date.now()}@test.govcongiants.org`,
          source: 'health-check',
        }),
      });
      const data = await res.json();
      return {
        passed: data.success === true || data.message?.includes('already'),
        message: data.success ? 'Lead captured' : data.message || 'Failed',
      };
    },
  },
];

// ============================================================
// MAIN HANDLER
// ============================================================

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const urlPassword = request.nextUrl.searchParams.get('password');
  const sendEmail = request.nextUrl.searchParams.get('email') === 'true';
  const format = request.nextUrl.searchParams.get('format') || 'json';

  // Verify auth (cron secret or admin password)
  const cronSecret = process.env.CRON_SECRET;
  const isAuthorized =
    authHeader === `Bearer ${cronSecret}` ||
    urlPassword === ADMIN_PASSWORD;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Health Check] Starting automated health check...');

  // Run all tests
  const results: TestResult[] = [];
  for (const test of tests) {
    const result = await runTest(test.name, test.category, test.fn);
    results.push(result);
    console.log(`[Health Check] ${result.passed ? '✓' : '✗'} ${test.name}: ${result.message}`);
  }

  // Build report
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const criticalFailures = results.filter(
    (r) => !r.passed && tests.find((t) => t.name === r.name)?.critical
  );

  const report: HealthCheckReport = {
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || 'unknown',
    totalTests: results.length,
    passed,
    failed,
    passRate: `${((passed / results.length) * 100).toFixed(1)}%`,
    results,
    criticalFailures,
  };

  // Send email alert if there are failures
  if (sendEmail && failed > 0) {
    try {
      const failedTests = results.filter((r) => !r.passed);
      const emailHtml = `
        <h2>🚨 GovCon Giants Health Check Alert</h2>
        <p><strong>Time:</strong> ${report.timestamp}</p>
        <p><strong>Pass Rate:</strong> ${report.passRate} (${passed}/${results.length})</p>
        <p><strong>Critical Failures:</strong> ${criticalFailures.length}</p>

        <h3>Failed Tests:</h3>
        <ul>
          ${failedTests.map((t) => `<li><strong>${t.name}</strong> (${t.category}): ${t.message}</li>`).join('')}
        </ul>

        <h3>All Results:</h3>
        <table border="1" cellpadding="8" style="border-collapse: collapse;">
          <tr style="background: #f0f0f0;">
            <th>Test</th>
            <th>Category</th>
            <th>Status</th>
            <th>Message</th>
            <th>Time</th>
          </tr>
          ${results
            .map(
              (r) => `
            <tr style="background: ${r.passed ? '#e8f5e9' : '#ffebee'};">
              <td>${r.name}</td>
              <td>${r.category}</td>
              <td>${r.passed ? '✓ Pass' : '✗ Fail'}</td>
              <td>${r.message}</td>
              <td>${r.responseTime}ms</td>
            </tr>
          `
            )
            .join('')}
        </table>

        <p style="color: #666; margin-top: 20px;">
          <a href="${BASE_URL}/test-protocol">Run manual test protocol →</a>
        </p>
      `;

      await getTransporter().sendMail({
        from: '"GovCon Giants" <hello@govconedu.com>',
        to: 'service@govcongiants.com',
        subject: `🚨 Health Check: ${failed} tests failed (${report.passRate} pass rate)`,
        html: emailHtml,
      });

      console.log('[Health Check] Alert email sent');
    } catch (emailError) {
      console.error('[Health Check] Failed to send alert email:', emailError);
    }
  }

  // Return response
  if (format === 'html') {
    const statusColor = failed === 0 ? '#10b981' : criticalFailures.length > 0 ? '#ef4444' : '#f59e0b';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Health Check Report</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 20px; background: #0f172a; color: #e2e8f0; }
          .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
          .status { width: 16px; height: 16px; border-radius: 50%; background: ${statusColor}; }
          .stats { display: flex; gap: 20px; margin-bottom: 20px; }
          .stat { background: #1e293b; padding: 16px; border-radius: 8px; }
          .stat-value { font-size: 24px; font-weight: bold; }
          .stat-label { color: #94a3b8; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #334155; }
          th { background: #334155; }
          .pass { color: #10b981; }
          .fail { color: #ef4444; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="status"></div>
          <h1>Health Check Report</h1>
        </div>
        <p style="color: #94a3b8;">${report.timestamp}</p>

        <div class="stats">
          <div class="stat">
            <div class="stat-value">${report.passRate}</div>
            <div class="stat-label">Pass Rate</div>
          </div>
          <div class="stat">
            <div class="stat-value" style="color: #10b981;">${passed}</div>
            <div class="stat-label">Passed</div>
          </div>
          <div class="stat">
            <div class="stat-value" style="color: ${failed > 0 ? '#ef4444' : '#10b981'};">${failed}</div>
            <div class="stat-label">Failed</div>
          </div>
          <div class="stat">
            <div class="stat-value" style="color: ${criticalFailures.length > 0 ? '#ef4444' : '#10b981'};">${criticalFailures.length}</div>
            <div class="stat-label">Critical</div>
          </div>
        </div>

        <table>
          <tr>
            <th>Test</th>
            <th>Category</th>
            <th>Status</th>
            <th>Message</th>
            <th>Time</th>
          </tr>
          ${results
            .map(
              (r) => `
            <tr>
              <td>${r.name}</td>
              <td>${r.category}</td>
              <td class="${r.passed ? 'pass' : 'fail'}">${r.passed ? '✓ Pass' : '✗ Fail'}</td>
              <td>${r.message}</td>
              <td>${r.responseTime}ms</td>
            </tr>
          `
            )
            .join('')}
        </table>
      </body>
      </html>
    `;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
  }

  return NextResponse.json(report);
}
