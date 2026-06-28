#!/usr/bin/env node
// clean_mc.js — strips metadata/id from multiple-choice JSON files
// Parses question text to extract options A-E, keeps question text clean
// Usage: node clean_mc.js
// Overwrites files in ./categories_mc/

const fs=require('fs'),path=require('path');
const DIR=path.join(__dirname,'categories_mc');
if(!fs.existsSync(DIR)){fs.mkdirSync(DIR,{recursive:true});console.log('Created ./categories_mc — add your MC JSON files there.');process.exit(0);}

const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.json'));
let total=0;
files.forEach(file=>{
  const fp=path.join(DIR,file);
  try{
    const data=JSON.parse(fs.readFileSync(fp,'utf8'));
    if(!Array.isArray(data)){console.warn(`  ⚠ ${file} — not an array`);return;}
    const cleaned=data.map(e=>{
      const q=e.question??e.Question??e.q??'';
      const a=e.answer??e.Answer??e.a??'';
      if(!q||!a) return null;

      // Parse options from question text: lines like "A. foo  B. bar  C. baz"
      // They may be inline or on separate lines
      const optRegex=/\b([A-E])[.)]\s*([^A-E\n.][^\n]*?)(?=\s+[A-E][.)]\s|\s*$)/gi;
      const options={};
      let qText=String(q);
      let match;
      while((match=optRegex.exec(qText))!==null){
        options[match[1].toUpperCase()]=match[2].trim();
      }

      // Strip the options block from the question text
      const cleanQ=qText.replace(/\s+[A-E][.)]\s[^\n]*/gi,'').trim();

      // Correct answer letter
      const correctLetter=String(a).trim().toUpperCase().replace(/[^A-E]/g,'');
      if(!correctLetter||!options[correctLetter]) return null;

      return {
        question: cleanQ,
        answer: correctLetter,
        options: options
      };
    }).filter(Boolean);

    fs.writeFileSync(fp,JSON.stringify(cleaned,null,2),'utf8');
    console.log(`  ✓ ${file} — ${cleaned.length} questions`);
    total+=cleaned.length;
  }catch(err){console.error(`  ✗ ${file} — ${err.message}`);}
});
console.log(`\nDone. ${total} MC questions across ${files.length} files.`);
