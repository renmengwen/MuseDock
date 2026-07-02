// One-off: prune legacy custom classes from styles.css that no JSX/JS references.
// Keeps @tailwind, @layer, :root vars, @keyframes, element/id/universal selectors,
// and any rule whose selector references a class that appears in src (word-boundary).
// Usage: node scripts/prune-css.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const ROOT = path.resolve(import.meta.dirname, '..');
const CSS = path.join(ROOT, 'frontend-react/src/styles.css');
const SRC = path.join(ROOT, 'frontend-react/src');
const WRITE = process.argv.includes('--write');
const ALWAYS_KEEP = new Set(['dark']); // shadcn theme hook, may only appear at runtime

// 1. Concatenate all source that could reference a class (exclude the CSS itself).
function collectSource(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectSource(p, acc);
    else if (/\.(jsx?|mjs|tsx?|html)$/.test(e.name)) acc.push(fs.readFileSync(p, 'utf8'));
  }
}
const chunks = [];
collectSource(SRC, chunks);
chunks.push(fs.readFileSync(path.join(ROOT, 'frontend-react/index.html'), 'utf8'));
const source = chunks.join('\n');

const CLASS_RE = /\.(-?[_a-zA-Z][\w-]*)/g;
const usedCache = new Map();
function isUsed(cls) {
  if (ALWAYS_KEEP.has(cls)) return true;
  if (usedCache.has(cls)) return usedCache.get(cls);
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const used = new RegExp(`(?<![\\w-])${esc}(?![\\w-])`).test(source);
  usedCache.set(cls, used);
  return used;
}

const css = fs.readFileSync(CSS, 'utf8');
const root = postcss.parse(css);
const dropped = [];

root.walkRules(rule => {
  // keep @keyframes step selectors (from/to/percentages)
  if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
  const parts = rule.selector.split(',').map(s => s.trim());
  // A selector part can only ever match if EVERY class token it references is
  // emitted somewhere in source (compound/descendant/:has all require co-presence).
  // A part with no class tokens is structural (element/id/*) -> always live.
  const liveParts = parts.filter(part => {
    const classes = [...part.matchAll(CLASS_RE)].map(m => m[1]);
    return classes.length === 0 || classes.every(isUsed);
  });
  if (liveParts.length === 0) {
    dropped.push({ sel: rule.selector.replace(/\s+/g, ' '), line: rule.source?.start?.line });
    rule.remove();
  } else if (liveParts.length < parts.length) {
    rule.selector = liveParts.join(',\n'); // drop dead comma-parts, keep the live ones
  }
});

// remove now-empty at-rules (@media/@supports/@layer wrappers)
let removedEmpty = 1;
while (removedEmpty) {
  removedEmpty = 0;
  root.walkAtRules(at => {
    if (/^(media|supports|layer)$/i.test(at.name) && at.nodes && at.nodes.length === 0) {
      at.remove(); removedEmpty++;
    }
  });
}

const out = root.toString();
const beforeLines = css.split('\n').length;
const afterLines = out.split('\n').length;

console.log(`Dropped ${dropped.length} rules:`);
for (const d of dropped) console.log(`  L${d.line}\t${d.sel}`);
console.log(`\nLines: ${beforeLines} -> ${afterLines}  (${WRITE ? 'WRITTEN' : 'dry-run'})`);

if (WRITE) {
  postcss.parse(out); // validate round-trip
  fs.writeFileSync(CSS, out);
}
