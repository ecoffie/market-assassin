#!/usr/bin/env node

/**
 * Quick test script to verify forecast download functionality
 * Tests downloading a single file without database operations
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const TEST_URL = 'https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx';
const TEST_PATH = path.join(__dirname, '..', 'tmp', 'forecasts', 'test-download.xlsx');

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading from ${url}...`);

    // Ensure directory exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(destPath);

    const request = https.get(url, {
      headers: {
        'User-Agent': 'GovConGiants/ForecastImporter (service@govcongiants.com)',
      },
    }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`Redirecting to ${redirectUrl}...`);
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        const stats = fs.statSync(destPath);
        console.log(`✅ Downloaded ${(stats.size / 1024).toFixed(1)} KB to ${destPath}`);
        resolve();
      });
    });

    request.on('error', (err) => {
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      reject(err);
    });

    file.on('error', (err) => {
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      reject(err);
    });
  });
}

async function main() {
  console.log('\n🧪 Testing Forecast Download');
  console.log('============================\n');

  try {
    await downloadFile(TEST_URL, TEST_PATH);
    console.log('\n✅ Test passed! Download functionality works.');
    console.log('\nNext steps:');
    console.log('  1. Run: node scripts/import-forecasts.js --dry-run');
    console.log('  2. Review sample records');
    console.log('  3. Run: node scripts/import-forecasts.js');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();
