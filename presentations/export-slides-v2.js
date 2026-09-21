const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function main() {
  const htmlFile = path.join(__dirname, 'JTED-2026-Revised.html');
  const outputDir = path.join(__dirname, 'slide-images-v2');

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Each slide is 100vh, so we set viewport to slide dimensions
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('Loading HTML...');
  await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle0' });

  // Get total slides
  const slideCount = await page.evaluate(() =>
    document.querySelectorAll('.slide').length
  );
  console.log(`Found ${slideCount} slides\n`);

  // Export each slide by isolating it
  for (let i = 0; i < slideCount; i++) {
    const slideNum = String(i + 1).padStart(3, '0');
    const outputPath = path.join(outputDir, `slide-${slideNum}.png`);

    // Hide all slides except current one, then screenshot
    await page.evaluate((index) => {
      const slides = document.querySelectorAll('.slide');
      slides.forEach((slide, j) => {
        slide.style.display = j === index ? 'flex' : 'none';
        if (j === index) {
          slide.style.minHeight = '100vh';
          slide.style.height = '100vh';
        }
      });
      window.scrollTo(0, 0);
    }, i);

    await page.screenshot({ path: outputPath, fullPage: false });
    process.stdout.write(`\rExported ${i + 1}/${slideCount}`);
  }

  await browser.close();
  console.log('\n\nVerifying exports...');

  // Verify each image is different
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));
  const sizes = new Set();
  for (const file of files) {
    const stat = fs.statSync(path.join(outputDir, file));
    sizes.add(stat.size);
  }

  console.log(`Unique image sizes: ${sizes.size} (should be close to ${slideCount})`);

  if (sizes.size < slideCount * 0.5) {
    console.error('ERROR: Too many duplicate slides detected!');
    process.exit(1);
  }

  console.log('\nCreating PowerPoint...');

  // Create PPTX
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
print(f'Saved {len(prs.slides)} slides to {output_path}')
`;

  fs.writeFileSync(path.join(__dirname, 'create-pptx-v2.py'), pythonScript);

  const { execSync } = require('child_process');
  execSync('python3 create-pptx-v2.py', { cwd: __dirname, stdio: 'inherit' });

  // Open and verify
  console.log('\nOpening PowerPoint...');
  execSync('open JTED-2026-Final.pptx', { cwd: __dirname });
}

main().catch(console.error);
