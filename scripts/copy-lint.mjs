#!/usr/bin/env node
// Copy lint: user-facing text must never say "should", "overdue", "deadline",
// "streak", "fail…" or "lazy". Scans string literals and JSX text in the UI
// code plus the strategy cards. Lines that *define* the rule (regexes,
// banned-word lists, comments) are skipped.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const BANNED = /\b(should(?:n['’]t)?|overdue|deadlines?|streaks?|fail(?:ed|ing|s|ure|ures)?|lazy)\b/i;
const TARGETS = ['shared/src', 'extension/src', 'dashboard/app', 'dashboard/components', 'dashboard/lib'];
const SKIP_LINE = /BANNED|banned|copy[- ]?rules|copy lint|RegExp|\/\\b|new RegExp|^\s*(\/\/|\*|\/\*)|eslint|Never:|never say/;
const SKIP_DIR = /node_modules|dist|\.next|test/;

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (SKIP_DIR.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|json|html)$/.test(name)) out.push(p);
  }
  return out;
}

const problems = [];
for (const t of TARGETS) {
  for (const file of walk(join(root, t))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (SKIP_LINE.test(line)) return;
      const texts = [
        ...(line.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []),
        ...(line.match(/>([^<>{}]+)</g) ?? []),
      ];
      for (const s of texts) {
        const m = s.match(BANNED);
        if (m) problems.push(`${relative(root, file)}:${i + 1}  "${m[0]}"  →  ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

if (problems.length) {
  console.error(`Copy lint: ${problems.length} gentle-language issue(s):\n` + problems.join('\n'));
  process.exit(1);
}
console.log('Copy lint: all user-facing text follows the gentle copy rules.');
