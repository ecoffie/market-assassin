const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function main() {
  const htmlFile = path.join(__dirname, 'JTED-2026-Revised.html');
  const outputDir = path.join(__dirname, 'slide-images-v3');

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Use 1280x720 viewport with 2x device scale for sharper text
  // This matches typical presentation display better
  await page.setViewport({
    width: 1280,
    height: 720,
    deviceScaleFactor: 2
  });

  console.log('Loading HTML...');
  await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle0' });

  const slideCount = await page.evaluate(() =>
    document.querySelectorAll('.slide').length
  );
  console.log(`Found ${slideCount} slides\n`);

  // Test first slide
  await page.evaluate(() => {
    const slides = document.querySelectorAll('.slide');
    slides.forEach((slide, j) => {
      slide.style.display = j === 0 ? 'flex' : 'none';
      if (j === 0) {
        slide.style.minHeight = '720px';
        slide.style.height = '720px';
      }
    });
    window.scrollTo(0, 0);
  });

  const testPath = path.join(outputDir, 'test-slide-001.png');
  await page.screenshot({ path: testPath });

  console.log('Test slide exported. Checking...');
  const { execSync } = require('child_process');
  execSync(`open "${testPath}"`);

  // Wait for user verification
  console.log('\nCheck the test image. Press Ctrl+C to abort, or wait 5 seconds to continue...\n');
  await new Promise(r => setTimeout(r, 5000));

  // Export all slides
  for (let i = 0; i < slideCount; i++) {
    const slideNum = String(i + 1).padStart(3, '0');
    const outputPath = path.join(outputDir, `slide-${slideNum}.png`);

    await page.evaluate((index) => {
      const slides = document.querySelectorAll('.slide');
      slides.forEach((slide, j) => {
        slide.style.display = j === index ? 'flex' : 'none';
        if (j === index) {
          slide.style.minHeight = '720px';
          slide.style.height = '720px';
        }
      });
      window.scrollTo(0, 0);
    }, i);

    await page.screenshot({ path: outputPath });
    process.stdout.write(`\rExported ${i + 1}/${slideCount}`);
  }

  await browser.close();
  console.log('\n\nCreating PowerPoint...');

  const pythonScript = `
import os
from pptx import Presentation
from pptx.util import Inches

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

blank_layout = prs.slide_layouts[6]
image_dir = '${outputDir}'

for i in range(1, ${slideCount} + 1):
    img_path = os.path.join(image_dir, f'slide-{i:03d}.png')
    if os.path.exists(img_path):
        slide = prs.slides.add_slide(blank_layout)
        slide.shapes.add_picture(img_path, Inches(0), Inches(0), width=Inches(13.333), height=Inches(7.5))

output_path = '${path.join(__dirname, 'JTED-2026-Final.pptx')}'
prs.save(output_path)
print(f'Saved {len(prs.slides)} slides')
`;

  fs.writeFileSync(path.join(__dirname, 'create-pptx-v3.py'), pythonScript);
  execSync('python3 create-pptx-v3.py', { cwd: __dirname, stdio: 'inherit' });

  console.log('\nOpening PowerPoint...');
  execSync('open JTED-2026-Final.pptx', { cwd: __dirname });
}

main().catch(console.error);
