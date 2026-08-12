#!/usr/bin/env node
/**
 * extract-design-system.mjs
 * ---------------------------------------------------------------------------
 * Single source of truth enforcement.
 *
 * `source/crystal-design-system.html` is the design system. This script lifts
 * its CSS and its icon sprite out of that file **verbatim** and writes them
 * into the web app. Nothing is retyped by hand, so a value can never drift
 * from the system that defines it.
 *
 * Outputs
 *   apps/web/src/styles/tokens.css     :root + [data-theme] blocks
 *   apps/web/src/styles/crystal.css    every component rule
 *   apps/web/src/generated/icons.ts    the 24px icon sprite as data
 *   apps/web/src/generated/manifest.json  what was taken, and what was left
 *
 * All four are gitignored: they are build artefacts, not source.
 * Run `npm run tokens` after any edit to the design system.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'source', 'crystal-design-system.html');
const STYLES_DIR = join(ROOT, 'apps', 'web', 'src', 'styles');
const GEN_DIR = join(ROOT, 'apps', 'web', 'src', 'generated');

/* ---------------------------------------------------------------------------
 * Which banner sections of the design system are product CSS, and which exist
 * only to render the documentation page itself.
 * ------------------------------------------------------------------------ */

/** Sections lifted whole (minus the denylist below). */
const COMPONENT_SECTIONS = [
  'BUTTONS',
  'FORM CONTROLS',
  'NAVIGATION',
  'CARDS',
  'BADGES · PILLS · AVATARS',
  'TABLE',
  'DATA VIZ',
  'FEEDBACK · ALERTS · TOASTS',
  'OVERLAYS',
  'STATES · LOADERS · MISC',
  // Added to the design system while building the PMS — see the report.
  'SCROLLBAR',
  'SIDEBAR RAIL',
  'CONTAINER GAUGE',
  'CHECKLIST',
  'ENTRANCE MOTION',
  'KANBAN BOARD',
  'RESPONSIVE TABLE',
  'MOBILE NAVIGATION',
  'DATA PANEL',
  'HEADLESS BINDINGS',
];

/** Sections that hold the theme contract. */
const TOKEN_SECTIONS = ['00 · GLOBAL TOKENS', 'THEME TOKENS'];

/**
 * Rules cherry-picked out of the documentation-only sections because they are
 * genuinely part of the system: the reset, the icon sizing scale, the page
 * hero, and the reduced-motion contract.
 */
const CHERRY_PICK = [
  '*',
  '::selection',
  'body',
  '.hero',
  '.hero-grid',
  '.hero .eyebrow',
  '.hero h1',
  '.hero h1 em',
  '.hero p',
  '.hero-stats',
  '.hero-stat b',
  '.hero-stat span',
  '.ic',
  '.ic.sm',
  '.ic.lg',
  '.ic.xl',
  // layout primitives the design system's own component examples rely on
  '.row',
  '.row.tight',
  '.col',
  '.lbl',
  // the manual reduced-motion escape hatch (the media query comes along with `*`)
  'body.reduce-motion *,body.reduce-motion *::before,body.reduce-motion *::after',
];

/** Documentation furniture that lives inside otherwise-product sections. */
const DENY = [
  '.zrow',
  '.motionbox',
  '@keyframes demo',
  '.contrastrow',
  '.ddgrid',
  '.ddbox',
  '.spec',
  '.swatches',
  '.topbar-in',
  '.appframe', // the docs' framed shell preview; the app uses a real layout
];

/* ---------------------------------------------------------------------------
 * A minimal CSS chunker. Splits a stylesheet into top-level rules while
 * respecting strings, comments and nesting, so @media / @keyframes stay intact.
 * ------------------------------------------------------------------------ */
function splitRules(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  let inComment = false;
  let inString = null;

  while (i < css.length) {
    const c = css[i];
    const n = css[i + 1];

    if (inComment) {
      if (c === '*' && n === '/') {
        inComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      inComment = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      i += 1;
      continue;
    }
    if (c === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === '}') {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        out.push(css.slice(start, i).trim());
        start = i;
      }
      continue;
    }
    i += 1;
  }

  const tail = css.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

/** Everything before the first top-level `{`, comments stripped. */
function preludeOf(rule) {
  const brace = rule.indexOf('{');
  const head = brace === -1 ? rule : rule.slice(0, brace);
  return head.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
}

function bodyOf(rule) {
  const open = rule.indexOf('{');
  const close = rule.lastIndexOf('}');
  return open === -1 || close === -1 ? '' : rule.slice(open + 1, close);
}

const isConditionalAtRule = (prelude) =>
  /^@(media|supports|container|layer)\b/.test(prelude);

/**
 * `.side` must not match `.side-brand`, so a prefix match only counts when the
 * next character cannot continue an identifier.
 */
function matchesSelector(part, needle) {
  if (!part.startsWith(needle)) return false;
  const next = part[needle.length];
  return next === undefined || !/[\w-]/.test(next);
}

function isDenied(prelude) {
  return DENY.some(
    (needle) =>
      matchesSelector(prelude, needle) ||
      prelude
        .split(',')
        .some((part) => part.trim().split(/\s+/).some((tok) => matchesSelector(tok, needle)))
  );
}

function isCherryPicked(prelude) {
  if (prelude.startsWith('@keyframes')) return false;
  return prelude
    .split(',')
    .map((s) => s.trim())
    .some((sel) => CHERRY_PICK.includes(sel));
}

/**
 * Filters a list of rules with `keep(prelude)`, recursing into @media so a
 * conditional block contributes only the rules that survive.
 */
function filterRules(rules, keep) {
  const kept = [];
  const dropped = [];
  for (const rule of rules) {
    const prelude = preludeOf(rule);
    if (isConditionalAtRule(prelude)) {
      const inner = filterRules(splitRules(bodyOf(rule)), keep);
      if (inner.kept.length) kept.push(`${prelude}{\n${inner.kept.join('\n')}\n}`);
      dropped.push(...inner.dropped);
      continue;
    }
    if (isDenied(prelude)) {
      dropped.push(prelude);
      continue;
    }
    if (keep(prelude)) kept.push(rule);
    else dropped.push(prelude);
  }
  return { kept, dropped };
}

/* ---------------------------------------------------------------------------
 * Read and slice the design system
 * ------------------------------------------------------------------------ */
const html = readFileSync(SOURCE, 'utf8');
const digest = createHash('sha256').update(html).digest('hex').slice(0, 12);

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error(`No <style> block found in ${SOURCE}`);
const stylesheet = styleMatch[1];

/**
 * The design system separates concerns with banner comments shaped like:
 *   /* ============ \n   NN · NAME \n   ============ *\/
 * Split on those to get named chunks.
 */
const BANNER = /\/\*\s*=+\s*\n\s*([^\n]+?)\s*\n[\s\S]*?=+\s*\*\//g;
const sections = [];
let match;
let cursor = 0;
let pendingName = '__preamble__';
/** `THEME TOKENS — every component reads only from these.` -> `THEME TOKENS` */
const sectionName = (raw) => raw.split(/\s+[—–-]\s+/)[0].trim();

while ((match = BANNER.exec(stylesheet)) !== null) {
  const css = stylesheet.slice(cursor, match.index).trim();
  if (css) sections.push({ name: pendingName, css });
  pendingName = sectionName(match[1]);
  cursor = BANNER.lastIndex;
}
const tailCss = stylesheet.slice(cursor).trim();
if (tailCss) sections.push({ name: pendingName, css: tailCss });

const named = new Map(sections.map((s) => [s.name, s.css]));
const missing = [...TOKEN_SECTIONS, ...COMPONENT_SECTIONS].filter((n) => !named.has(n));
if (missing.length) {
  throw new Error(
    `Design system section(s) not found: ${missing.join(', ')}.\n` +
      `Found: ${[...named.keys()].join(' | ')}\n` +
      `The banner comments in ${relative(ROOT, SOURCE)} changed — update COMPONENT_SECTIONS.`
  );
}

/* ---------------------------------------------------------------------------
 * tokens.css — the theme contract, byte-for-byte
 * ------------------------------------------------------------------------ */
const tokensCss = TOKEN_SECTIONS.map((name) => `/* ${name} */\n${named.get(name)}`).join('\n\n');

/* ---------------------------------------------------------------------------
 * crystal.css — every component rule
 * ------------------------------------------------------------------------ */
const parts = [];
const droppedAll = [];

// Cherry-picked rules from the documentation-only sections, in source order.
for (const { name, css } of sections) {
  if (TOKEN_SECTIONS.includes(name) || COMPONENT_SECTIONS.includes(name)) continue;
  const { kept, dropped } = filterRules(splitRules(css), isCherryPicked);
  droppedAll.push(...dropped);
  if (kept.length) parts.push(`/* ${name} — foundation rules used by the product */\n${kept.join('\n')}`);
}

// Whole component sections.
for (const name of COMPONENT_SECTIONS) {
  const { kept, dropped } = filterRules(splitRules(named.get(name)), () => true);
  droppedAll.push(...dropped);
  parts.push(`/* ${name} */\n${kept.join('\n')}`);
}

const banner = (file) =>
  `/*\n * ${file}\n *\n * GENERATED — do not edit.\n * Lifted verbatim from source/crystal-design-system.html (sha256:${digest})\n * by tools/extract-design-system.mjs. Change the design system, then run:\n *   npm run tokens\n */\n\n`;

const crystalCss = parts.join('\n\n');

/* ---------------------------------------------------------------------------
 * icons.ts — the 24px sprite, so the app cannot invent a second icon set
 * ------------------------------------------------------------------------ */
const symbols = [...html.matchAll(/<symbol id="(i-[\w-]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)];
// The design system declares its sprite once; the concept file had a rival set.
const uniqueSymbols = new Map();
for (const [, id, viewBox, body] of symbols) {
  if (!uniqueSymbols.has(id)) uniqueSymbols.set(id, { viewBox, body: body.trim() });
}
if (uniqueSymbols.size < 40) {
  throw new Error(`Only ${uniqueSymbols.size} icons extracted — the sprite markup changed shape.`);
}

const iconEntries = [...uniqueSymbols.entries()]
  .map(([id, { viewBox, body }]) => `  '${id.replace(/^i-/, '')}': { viewBox: '${viewBox}', d: ${JSON.stringify(body)} },`)
  .join('\n');

const iconsTs = `/*
 * icons.ts
 *
 * GENERATED — do not edit.
 * The complete icon library from source/crystal-design-system.html
 * (sha256:${digest}), extracted by tools/extract-design-system.mjs.
 *
 * Section 06 of the design system: outline only, 1.7px stroke, 24px box,
 * round caps and joins. There is exactly one icon set. Adding an icon means
 * adding it to the design system first, then re-running \`npm run tokens\`.
 */

export const ICONS = {
${iconEntries}
} as const;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
`;

/* ---------------------------------------------------------------------------
 * Write
 * ------------------------------------------------------------------------ */
mkdirSync(STYLES_DIR, { recursive: true });
mkdirSync(GEN_DIR, { recursive: true });

writeFileSync(join(STYLES_DIR, 'tokens.css'), banner('tokens.css') + tokensCss + '\n', 'utf8');
writeFileSync(join(STYLES_DIR, 'crystal.css'), banner('crystal.css') + crystalCss + '\n', 'utf8');
writeFileSync(join(GEN_DIR, 'icons.ts'), iconsTs, 'utf8');

const manifest = {
  source: relative(ROOT, SOURCE).replace(/\\/g, '/'),
  sha256: digest,
  generatedAt: null, // deliberately absent: a timestamp would churn the diff
  sections: sections.map((s) => s.name),
  tokenSections: TOKEN_SECTIONS,
  componentSections: COMPONENT_SECTIONS,
  cherryPicked: CHERRY_PICK,
  icons: uniqueSymbols.size,
  droppedSelectors: [...new Set(droppedAll)].sort(),
};
writeFileSync(join(GEN_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)}kB`;
console.log(`design system  sha256:${digest}`);
console.log(`  tokens.css   ${kb(tokensCss)}  (${TOKEN_SECTIONS.length} sections)`);
console.log(`  crystal.css  ${kb(crystalCss)}  (${COMPONENT_SECTIONS.length} sections + ${CHERRY_PICK.length} foundation rules)`);
console.log(`  icons.ts     ${uniqueSymbols.size} icons`);
console.log(`  dropped      ${manifest.droppedSelectors.length} documentation-only selectors`);
