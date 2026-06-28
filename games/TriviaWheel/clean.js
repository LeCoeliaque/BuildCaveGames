#!/usr/bin/env node
/**
 * clean.js — strips ID and Metadata fields from category JSON files
 * Usage: node clean.js
 * Overwrites all .json files in ./categories in place
 */

const fs = require('fs');
const path = require('path');

const CATEGORIES_DIR = path.join(__dirname, 'categories');

if (!fs.existsSync(CATEGORIES_DIR)) {
  console.error('No ./categories folder found. Create it and add your JSON files.');
  process.exit(1);
}

const files = fs.readdirSync(CATEGORIES_DIR).filter(f => f.endsWith('.json'));

if (!files.length) {
  console.log('No .json files found in ./categories');
  process.exit(0);
}

let total = 0;
let errors = 0;

for (const file of files) {
  const filePath = path.join(CATEGORIES_DIR, file);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      console.warn(`  ⚠ ${file} — not an array, skipping`);
      errors++;
      continue;
    }

    const cleaned = data
      .map(entry => {
        // Keep only Question and Answer, normalise casing
        const q = entry.Question ?? entry.question ?? entry.q ?? null;
        const a = entry.Answer ?? entry.answer ?? entry.a ?? null;

        if (!q || !a) return null; // skip malformed entries

        return { Question: String(q).trim(), Answer: String(a).trim() };
      })
      .filter(Boolean);

    fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2), 'utf8');
    console.log(`  ✓ ${file} — ${cleaned.length} questions (was ${data.length})`);
    total += cleaned.length;
  } catch (err) {
    console.error(`  ✗ ${file} — ${err.message}`);
    errors++;
  }
}

console.log(`\nDone. ${total} questions across ${files.length - errors} files.`);
if (errors) console.warn(`${errors} file(s) had errors — check above.`);
