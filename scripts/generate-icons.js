#!/usr/bin/env node
/**
 * Icon Generator for Money Control System PWA
 * Run: node scripts/generate-icons.js
 * Requires: npm install sharp --save-dev
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const svgPath = path.join(__dirname, '../public/icons/icon.svg');
const outDir = path.join(__dirname, '../public/icons');

async function generate() {
  const svgBuffer = fs.readFileSync(svgPath);
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png`);
  }
  // Apple touch icon
  await sharp(svgBuffer).resize(180, 180).png().toFile(path.join(outDir, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');
  // Favicon
  await sharp(svgBuffer).resize(32, 32).png().toFile(path.join(outDir, 'favicon-32.png'));
  console.log('✓ favicon-32.png');
  console.log('\nAll icons generated successfully!');
}

generate().catch(console.error);
