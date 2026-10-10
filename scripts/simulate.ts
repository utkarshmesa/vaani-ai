/**
 * npm run simulate -- <fixture> [--keep-time] [--url http://localhost:3000]
 *
 * POSTs fixtures/<fixture>.json to the local webhook (SPEC §15). If fixtures/<fixture>.transfer.json exists
 * (t09_failed), that transfer event is posted first, as Vaani would.
 * By default the payload timestamp is set to now, so the call shows up in the dashboard's current month;
 * --keep-time keeps the fixture's September 2026 timestamp. Use "all" to post every fixture.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const args = process.argv.slice(2);
const keepTime = args.includes('--keep-time');
const urlFlag = args.indexOf('--url');
const baseUrl = (urlFlag >= 0 ? args[urlFlag + 1] : process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url');

const available = readdirSync('fixtures').filter((f) => f.endsWith('.json') && !f.includes('.transfer.')).map((f) => f.replace('.json', ''));

if (!name || (name !== 'all' && !available.includes(name))) {
  console.error(`Usage: npm run simulate -- <${available.join('|')}|all> [--keep-time] [--url <base>]`);
  process.exit(1);
}

const secret = process.env.VAANI_WEBHOOK_SECRET;
if (!secret) {
  console.error('VAANI_WEBHOOK_SECRET is not set (add it to .env.local).');
  process.exit(1);
}
const endpoint = `${baseUrl}/api/webhooks/vaani?token=${encodeURIComponent(secret)}`;

async function post(label: string, body: unknown) {
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  console.log(`${label}: ${res.status} ${await res.text()}`);
  if (!res.ok) process.exitCode = 1;
}

for (const fixture of name === 'all' ? available : [name]) {
  const transferPath = `fixtures/${fixture}.transfer.json`;
  if (existsSync(transferPath)) await post(`${fixture} (transfer event)`, JSON.parse(readFileSync(transferPath, 'utf8')));
  const payload = JSON.parse(readFileSync(`fixtures/${fixture}.json`, 'utf8'));
  if (!keepTime) payload.timestamp = new Date().toISOString();
  await post(fixture, payload);
}
