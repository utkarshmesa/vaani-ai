/**
 * npm run stress -- --env .env.production.local
 *
 * Stress-tests a deployed instance through its public endpoints (uses VAANI_WEBHOOK_SECRET / CRON_SECRET /
 * APP_BASE_URL from the env file). Every call id is prefixed "stress-<run>-" so the data is easy to find.
 *   1. all fixtures once (real Gemini + Resend on production: 3 designer + 2 urgent emails)
 *   2. 15 concurrent deliveries of the same declined call  → must store 1 call / 1 lead
 *   3. 10 different declined calls at once                  → must store 10
 *   4. malformed payloads                                   → must answer 200/400, never 5xx
 *   5. wrong token / wrong cron secret                      → must answer 401
 * Prints the run id; verify the database afterwards (see NOTES.md).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const envFile = args[args.indexOf('--env') + 1] ?? '.env.local';
if (!existsSync(envFile)) {
  console.error(`Env file not found: ${envFile}`);
  process.exit(1);
}
process.loadEnvFile(envFile);
const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const hook = `${base}/api/webhooks/vaani?token=${encodeURIComponent(process.env.VAANI_WEBHOOK_SECRET ?? '')}`;
const run = `stress-${Date.now()}`;

const fixture = (name: string) => JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8'));
const withId = (p: Record<string, any>, id: string) => {
  p.call_id = p.data.call_id = p.data.room_name = id;
  p.timestamp = new Date().toISOString();
  return p;
};
const post = async (url: string, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) => {
  const t = Date.now();
  const res = await fetch(url, { method: 'POST', headers, body });
  return { status: res.status, ms: Date.now() - t };
};
const summary = (label: string, rs: { status: number; ms: number }[]) => {
  const counts = rs.reduce<Record<number, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${label.padEnd(44)} statuses ${JSON.stringify(counts)}  p50 ${ms[Math.floor(ms.length / 2)]} ms  max ${ms.at(-1)} ms`);
  return counts;
};

console.log(`run ${run} → ${base}\n`);
let ok = true;

// 1. every fixture once
const names = readdirSync('fixtures').filter((f) => f.endsWith('.json') && !f.includes('.transfer.')).map((f) => f.replace('.json', ''));
const r1 = [];
for (const n of names) {
  const id = `${run}-${n}`;
  if (existsSync(`fixtures/${n}.transfer.json`)) {
    const t = JSON.parse(readFileSync(`fixtures/${n}.transfer.json`, 'utf8'));
    t.room_name = id;
    r1.push(await post(hook, JSON.stringify(t)));
  }
  r1.push(await post(hook, JSON.stringify(withId(fixture(n), id))));
}
ok = summary('1. all fixtures', r1)[200] === r1.length && ok;

// 2. duplicate burst
const dup = JSON.stringify(withId(fixture('t10'), `${run}-dup`));
const r2 = await Promise.all(Array.from({ length: 15 }, () => post(hook, dup)));
ok = summary('2. 15 concurrent duplicates', r2)[200] === 15 && ok;

// 3. distinct burst
const r3 = await Promise.all(Array.from({ length: 10 }, (_, i) => post(hook, JSON.stringify(withId(fixture('t10'), `${run}-bulk-${i}`)))));
ok = summary('3. 10 concurrent distinct calls', r3)[200] === 10 && ok;

// 4. malformed
const junk = ['{}', '[]', 'null', '"x"', '{"event":"call_postprocessing"}', `{"event":"call_postprocessing","call_id":"${run}-junk","data":{"entities":"x","transcript":5}}`, '{"event":"human_transfer_failed"}', '{"truncated":'];
const r4 = await Promise.all(junk.map((b) => post(hook, b)));
const c4 = summary('4. malformed payloads', r4);
ok = !Object.keys(c4).some((s) => Number(s) >= 500) && ok;

// 5. auth
const r5 = await Promise.all([
  post(`${base}/api/webhooks/vaani?token=wrong`, dup),
  post(`${base}/api/webhooks/vaani`, dup),
  post(`${base}/api/cron/tick`, '{}', { authorization: 'Bearer wrong' }),
  post(`${base}/api/cron/tick`, '{}', {}),
]);
ok = summary('5. bad credentials', r5)[401] === 4 && ok;

console.log(`\n${ok ? 'PASS' : 'FAIL'} (HTTP layer). Now check the database for call ids starting "${run}".`);
process.exit(ok ? 0 : 1);
