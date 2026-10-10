/**
 * npm run simulate -- <fixture> [--keep-time] [--url http://localhost:3000] [--env <file>] [--test-id]
 *
 * POSTs fixtures/<fixture>.json to the local webhook (SPEC §15). If fixtures/<fixture>.transfer.json exists
 * (t09_failed), that transfer event is posted first, as Vaani would.
 * By default the payload timestamp is set to now, so the call shows up in the dashboard's current month;
 * --keep-time keeps the fixture's September 2026 timestamp. Use "all" to post every fixture.
 * --env <file> reads VAANI_WEBHOOK_SECRET / APP_BASE_URL from that file instead of .env.local
 *   (e.g. .env.production.local to test the deployed app).
 * --test-id gives the call a fresh "test-<time>-<fixture>" id, so it is clearly test data and can be re-run.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
const envFile = envFlag >= 0 ? args[envFlag + 1] : '.env.local';
if (existsSync(envFile)) process.loadEnvFile(envFile);
else if (envFlag >= 0) {
  console.error(`Env file not found: ${envFile}`);
  process.exit(1);
}
const testId = args.includes('--test-id');
const keepTime = args.includes('--keep-time');
const urlFlag = args.indexOf('--url');
const baseUrl = (urlFlag >= 0 ? args[urlFlag + 1] : process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url' && args[i - 1] !== '--env');

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
  const payload = JSON.parse(readFileSync(`fixtures/${fixture}.json`, 'utf8'));
  const callId = testId ? `test-${Date.now()}-${fixture}` : payload.call_id;
  payload.call_id = payload.data.call_id = payload.data.room_name = callId;
  if (!keepTime) payload.timestamp = new Date().toISOString();

  const transferPath = `fixtures/${fixture}.transfer.json`;
  if (existsSync(transferPath)) {
    const transfer = JSON.parse(readFileSync(transferPath, 'utf8'));
    transfer.room_name = callId;
    await post(`${fixture} (transfer event)`, transfer);
  }
  await post(`${fixture} [${callId}]`, payload);
}
