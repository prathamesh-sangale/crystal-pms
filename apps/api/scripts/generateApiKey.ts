/**
 * Creates a new external API key and writes the raw value to a local,
 * gitignored file — never printed to a terminal someone else might see
 * over your shoulder or that ends up in a shared log, same handling as
 * every other secret this project has generated. The database only ever
 * stores this key's hash; this file is the one and only place the raw
 * value exists after this script finishes.
 *
 * Usage: npm run generate-api-key -- "IMS integration"
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiKey } from '../src/apiKeys.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const name = process.argv[2] ?? 'unnamed key';
  const rawKey = await createApiKey(name);
  const outPath = path.join(__dirname, '..', 'credentials', `api-key-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`);
  writeFileSync(outPath, rawKey + '\n');
  console.log(`Created API key "${name}". Saved to: ${outPath}`);
  console.log('This is the only time the raw key is shown/saved anywhere — the database only keeps its hash.');
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
