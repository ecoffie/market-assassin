const puppeteer = require('puppeteer');
const path = require('path');

async function captureScreenshots() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Set viewport for good quality screenshots
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });

  const outputDir = path.join(__dirname, '../public/images/products/guides-templates');

  // Agency Pain Points Report
  console.log('Capturing Agency Pain Points Report...');
  await page.goto('file:///Users/ericcoffie/Bootcamp/AGENCY-PAIN-POINTS-REPORT.html', { waitUntil: 'networkidle0' });

  // Screenshot 1: Executive Summary (top of page)
  await page.screenshot({
    path: path.join(outputDir, 'agency-pain-points-1.png'),
  });
  console.log('  - Captured Executive Summary');

  // Screenshot 2: Pain Point Categories - scroll down
  await page.evaluate(() => window.scrollBy(0, 850));
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(outputDir, 'agency-pain-points-2.png'),
  });
  console.log('  - Captured Pain Point Categories');

  // Screenshot 3: Decision Matrix - scroll more
  await page.evaluate(() => window.scrollBy(0, 2200));
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(outputDir, 'agency-pain-points-3.png'),
  });
  console.log('  - Captured Decision Matrix');

  await browser.close();
  console.log('Done! Screenshots saved to:', outputDir);
}

captureScreenshots().catch(console.error);
