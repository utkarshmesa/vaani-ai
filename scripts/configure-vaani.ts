/**
 * npm run vaani:configure -- --dry-run            print the PATCH bodies (no API calls)
 * npm run vaani:configure                         apply to VAANI_AGENT_ID using VAANI_API_KEY
 * npm run vaani:configure -- --import-json <file> write a complete agent for the dashboard's "Import from JSON"
 *
 * Source of truth: VAANI_AGENT.md (prompt, greeting, FAQ, guardrails, disposition) and lib/leadSchema.ts
 * (extraction data points). Edit those, then re-run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setAdapters } from '@/lib/adapters';
import { mocks } from '@/lib/adapters/mocks';
import { createVaaniAdapter } from '@/lib/adapters/vaani';
import { buildAgentImport } from '@/lib/vaaniConfig/build';
import { configureVaani } from '@/lib/vaaniConfig/configure';
import { parseAgentMd } from '@/lib/vaaniConfig/parseAgentMd';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const args = process.argv.slice(2);
const md = readFileSync('VAANI_AGENT.md', 'utf8');
const importIdx = args.indexOf('--import-json');

if (importIdx >= 0) {
  const out = args[importIdx + 1];
  if (!out) {
    console.error('Usage: npm run vaani:configure -- --import-json <file.json>');
    process.exit(1);
  }
  writeFileSync(out, JSON.stringify(buildAgentImport(parseAgentMd(md)), null, 2));
  console.log(`Wrote ${out} — Design → Agents → New Agent → Import from JSON.`);
} else {
  const dryRun = args.includes('--dry-run');
  if (!dryRun) {
    const apiKey = process.env.VAANI_API_KEY;
    if (!apiKey) {
      console.error('VAANI_API_KEY is not set (add it to .env.local).');
      process.exit(1);
    }
    // Always the real Vaani API here, even if the app itself runs with MOCK_EXTERNAL=1.
    setAdapters({ ...mocks, vaani: createVaaniAdapter({ apiKey }) });
  }
  try {
    await configureVaani({ md, agentId: process.env.VAANI_AGENT_ID ?? '', dryRun, log: (s) => console.log(s) });
    if (!dryRun) console.log(`\nAgent ${process.env.VAANI_AGENT_ID} configured.`);
  } catch (err) {
    console.error(String((err as Error).message ?? err));
    process.exit(1);
  }
}
