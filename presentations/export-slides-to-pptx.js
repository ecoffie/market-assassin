const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function exportSlidesToImages() {
  const htmlFile = path.join(__dirname, 'JTED-2026-Revised.html');
  const outputDir = path.join(__dirname, 'slide-images');

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();

  // Set viewport to 1920x1080 (16:9)
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('Loading HTML file...');
  await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle0' });

  // Get all slides
  const slideCount = await page.evaluate(() => {
    return document.querySelectorAll('.slide').length;
  });

  console.log(`Found ${slideCount} slides`);

  // Screenshot each slide
  for (let i = 0; i < slideCount; i++) {
    const slideNum = String(i + 1).padStart(3, '0');
    const outputPath = path.join(outputDir, `slide-${slideNum}.png`);

    // Scroll to slide and screenshot
    await page.evaluate((index) => {
      const slides = document.querySelectorAll('.slide');
      slides[index].scrollIntoView();
    }, i);

    // Get the slide element bounds
    const slideBox = await page.evaluate((index) => {
      const slide = document.querySelectorAll('.slide')[index];
      const rect = slide.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    }, i);

    // Screenshot just this slide at 1920x1080
    await page.screenshot({
      path: outputPath,
      clip: {
        x: 0,
        y: slideBox.y,
        width: 1920,
        height: 1080
      }
    });

    process.stdout.write(`\rExported slide ${i + 1}/${slideCount}`);
  }

  console.log('\n\nDone exporting images!');
  await browser.close();

  return { outputDir, slideCount };
}

async function createPptxFromImages(outputDir, slideCount) {
  // Use python-pptx to create PPTX from images
  const pythonScript = `
import os
from pptx import Presentation
from pptx.util import Inches

# Create presentation with 16:9 aspect ratio
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

# Get blank layout
blank_layout = prs.slide_layouts[6]

# Add each image as a slide
image_dir = '${outputDir}'
for i in range(1, ${slideCount} + 1):
    img_path = os.path.join(image_dir, f'slide-{i:03d}.png')
    if os.path.exists(img_path):
        slide = prs.slides.add_slide(blank_layout)
        # Add image to fill the slide
        slide.shapes.add_picture(img_path, Inches(0), Inches(0), width=Inches(13.333), height=Inches(7.5))
        print(f'Added slide {i}')

prs.save('${path.join(__dirname, 'JTED-2026-Final.pptx')}')
print(f'\\nSaved JTED-2026-Final.pptx with {len(prs.slides)} slides')
`;

  fs.writeFileSync(path.join(__dirname, 'create-pptx.py'), pythonScript);

  const { execSync } = require('child_process');
  execSync('python3 create-pptx.py', { cwd: __dirname, stdio: 'inherit' });
}

async function main() {
  try {
    const { outputDir, slideCount } = await exportSlidesToImages();
    console.log('\nCreating PowerPoint from images...');
    await createPptxFromImages(outputDir, slideCount);
    console.log('\nComplete! Opening JTED-2026-Final.pptx...');

    const { execSync } = require('child_process');
    execSync('open JTED-2026-Final.pptx', { cwd: __dirname });
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
