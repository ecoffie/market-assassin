const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function main() {
  const htmlFile = path.join(__dirname, 'JTED-2026-Revised.html');
  const outputDir = path.join(__dirname, 'slide-images-compressed');

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // 1280x720 with 2x scale = 2560x1440 output, then compress as JPEG
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

  for (let i = 0; i < slideCount; i++) {
    const slideNum = String(i + 1).padStart(3, '0');
    const outputPath = path.join(outputDir, `slide-${slideNum}.jpg`);

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

    // Export as JPEG with 85% quality
    await page.screenshot({
      path: outputPath,
      type: 'jpeg',
      quality: 85
    });
    process.stdout.write(`\rExported ${i + 1}/${slideCount}`);
  }

  await browser.close();

  // Check total size
  const files = fs.readdirSync(outputDir);
  let totalSize = 0;
  for (const file of files) {
    totalSize += fs.statSync(path.join(outputDir, file)).size;
  }
  console.log(`\n\nTotal image size: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);

  console.log('Creating PowerPoint...');

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
    img_path = os.path.join(image_dir, f'slide-{i:03d}.jpg')
    if os.path.exists(img_path):
        slide = prs.slides.add_slide(blank_layout)
        slide.shapes.add_picture(img_path, Inches(0), Inches(0), width=Inches(13.333), height=Inches(7.5))

output_path = '${path.join(__dirname, 'JTED-2026-Compressed.pptx')}'
prs.save(output_path)
print(f'Saved {len(prs.slides)} slides')
`;

  fs.writeFileSync(path.join(__dirname, 'create-pptx-compressed.py'), pythonScript);

  const { execSync } = require('child_process');
  execSync('python3 create-pptx-compressed.py', { cwd: __dirname, stdio: 'inherit' });

  // Show file size
  const stat = fs.statSync(path.join(__dirname, 'JTED-2026-Compressed.pptx'));
  console.log(`\nFinal size: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

  console.log('Opening...');
  execSync('open JTED-2026-Compressed.pptx', { cwd: __dirname });
}

main().catch(console.error);
