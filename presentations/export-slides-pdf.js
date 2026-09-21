const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function exportSlidesPDF() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Set viewport to match slide dimensions (16:9)
  await page.setViewport({ width: 1280, height: 720 });

  // Load the HTML file
  const htmlPath = path.join(__dirname, 'JTED-2026-Revised.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  // Modify the page for PDF export - show all slides as pages
  await page.evaluate(() => {
    // Remove controls
    const controls = document.querySelector('.controls');
    if (controls) controls.remove();

    // Style all slides for print
    const slides = document.querySelectorAll('.slide');
    slides.forEach(slide => {
      slide.style.display = 'flex';
      slide.style.pageBreakAfter = 'always';
      slide.style.marginBottom = '0';
      slide.style.height = '100vh';
      slide.style.width = '100vw';
      slide.style.position = 'relative';
    });

    // Remove the last page break
    if (slides.length > 0) {
      slides[slides.length - 1].style.pageBreakAfter = 'auto';
    }
  });

  // Export to PDF
  const outputPath = path.join(__dirname, 'JTED-2026-Slides.pdf');

  await page.pdf({
    path: outputPath,
    width: '1280px',
    height: '720px',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });

  console.log(`PDF exported to: ${outputPath}`);

  // Copy to govcon-funnels public downloads
  const downloadPath = '/Users/ericcoffie/govcon-funnels/public/downloads/JTED-2026-Slides.pdf';
  fs.copyFileSync(outputPath, downloadPath);
  console.log(`Copied to: ${downloadPath}`);

  await browser.close();
}

exportSlidesPDF().catch(console.error);
