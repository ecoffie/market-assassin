const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function exportSlides() {
  const outputDir = path.join(__dirname, 'jted-2026-pngs');

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Set viewport to match slide dimensions
  await page.setViewport({ width: 1280, height: 720 });

  // Load the HTML file
  const htmlPath = path.join(__dirname, 'JTED-2026-Revised.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  // Get total number of slides
  const totalSlides = await page.evaluate(() => {
    return document.querySelectorAll('.slide').length;
  });

  console.log(`Found ${totalSlides} slides to export...`);

  // Export each slide
  for (let i = 0; i < totalSlides; i++) {
    // Show only the current slide
    await page.evaluate((index) => {
      const slides = document.querySelectorAll('.slide');
      slides.forEach((slide, idx) => {
        slide.style.display = idx === index ? 'flex' : 'none';
      });
      // Hide controls
      const controls = document.querySelector('.controls');
      if (controls) controls.style.display = 'none';
    }, i);

    // Take screenshot
    const slideNum = String(i + 1).padStart(2, '0');
    const outputPath = path.join(outputDir, `slide-${slideNum}.png`);

    await page.screenshot({
      path: outputPath,
      type: 'png',
      clip: { x: 0, y: 0, width: 1280, height: 720 }
    });

    console.log(`Exported slide ${i + 1}/${totalSlides}`);
  }

  await browser.close();
  console.log(`\nDone! Slides exported to: ${outputDir}`);
}

exportSlides().catch(console.error);
