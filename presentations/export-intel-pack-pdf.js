const puppeteer = require('puppeteer');
const path = require('path');

async function exportIntelPackPDF() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Load the HTML file
  const htmlPath = path.join(__dirname, 'JTED-2026-Intel-Pack.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  // Export to PDF
  const outputPath = path.join(__dirname, 'JTED-2026-Intel-Pack.pdf');

  await page.pdf({
    path: outputPath,
    format: 'letter',
    printBackground: true,
    margin: {
      top: '0.5in',
      right: '0.5in',
      bottom: '0.5in',
      left: '0.5in'
    }
  });

  console.log(`PDF exported to: ${outputPath}`);

  // Also copy to govcon-funnels public downloads
  const downloadPath = '/Users/ericcoffie/govcon-funnels/public/downloads/JTED-2026-Intel-Pack.pdf';
  const fs = require('fs');
  fs.copyFileSync(outputPath, downloadPath);
  console.log(`Copied to: ${downloadPath}`);

  await browser.close();
}

exportIntelPackPDF().catch(console.error);
