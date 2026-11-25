#!/usr/bin/env node
// تنبيه بسيط: لو أي ملف كود كبر أكتر من الحد، الأداة بتقول عليه.
// الافتراضي: تنبيه بس (exit 0) — مش بتمنع. لو عايز تمنع: node scripts/check-file-size.mjs --strict
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LIMIT_LINES = 500;
const LIMIT_KB = 80;
const strict = process.argv.includes('--strict');

const SKIP_DIRS = /(^|\/)(node_modules|dist|\.astro|\.preview|\.wrangler|\.freebuff|public)\//;
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const CHECK_EXT = /\.(astro|ts|tsx|js|jsx|mjs|cjs|css|json|md|toml|ya?ml|sql|html)$/;

let files = [];
try {
  files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
} catch {
  console.error('⚠️  مش قادر أقرا قائمة ملفات Git. شغّل الأمر من جوه مجلد المشروع.');
  process.exit(0);
}

const big = [];
for (const file of files) {
  if (SKIP_DIRS.test(file) || SKIP_FILES.test(file) || !CHECK_EXT.test(file)) continue;

  let content;
  try {
    content = readFileSync(file);
  } catch {
    continue; // ملف مش موجود (متحذف مثلاً) — نتخطاه
  }

  const lines = content.toString('utf8').split('\n').length;
  const kb = content.length / 1024;
  if (lines > LIMIT_LINES || kb > LIMIT_KB) big.push({ file, lines, kb });
}

if (big.length === 0) {
  console.log(`✅ مفيش ملف كبر عن الحد (${LIMIT_LINES} سطر / ${LIMIT_KB} كيلوبايت).`);
  process.exit(0);
}

big.sort((a, b) => b.lines - a.lines);
console.log(`\n⚠️  ${big.length} ملف كبر عن الحد (${LIMIT_LINES} سطر أو ${LIMIT_KB} كيلوبايت):\n`);
for (const { file, lines, kb } of big) {
  console.log(`   • ${file} — ${lines} سطر / ${kb.toFixed(1)} كيلوبايت`);
}
console.log('\n   الملف الكبير صعب تقراه وتعدله. قسّمه لملفات أصغر (مكوّنات، دوال، أو CSS منفصل).');
console.log(
  '   لو الملف المقصود مستقل بطبيعته (زي ملف أنماط شامل)، سجّله في scripts/check-file-size.mjs كاستثناء.\n',
);

process.exit(strict ? 1 : 0);
