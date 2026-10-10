import { getRepo } from '@/lib/db';
import { checkLowBalance, retryMissingCosts, sendEscalations, sendOutcomeRequests, sendReminders } from './jobs';

export interface TickSummary {
  reminders: string[];
  escalations: string[];
  outcomeRequests: string[];
  costsFilled: string[];
  lowBalanceAlert: boolean;
  errors: { job: string; error: string }[];
}

/**
 * One cron tick (SPEC §13), called every minute by pg_cron. Each job runs on its own: a failure is recorded
 * as a `cron_error` event and in the summary, and the other jobs still run.
 */
export async function runTick(): Promise<TickSummary> {
  const repo = getRepo();
  const summary: TickSummary = { reminders: [], escalations: [], outcomeRequests: [], costsFilled: [], lowBalanceAlert: false, errors: [] };
  const settings = await repo.getSettings();

  const job = async <T>(name: string, run: () => Promise<T>, onOk: (v: T) => void) => {
    try {
      onOk(await run());
    } catch (err) {
      const error = String((err as Error)?.message ?? err).slice(0, 1000);
      summary.errors.push({ job: name, error });
      await repo.insertEvent({ type: 'cron_error', meta: { job: name, error } }).catch(() => undefined);
    }
  };

  // Reminders before escalations, so a lead overdue for both (e.g. after downtime) gets them in order.
  await job('reminders', async () => sendReminders(await repo.listLeads({ active: true }), settings), (v) => { summary.reminders = v; });
  await job('escalations', async () => sendEscalations(await repo.listLeads({ active: true }), settings), (v) => { summary.escalations = v; });
  await job('outcomeRequests', async () => sendOutcomeRequests(await repo.listLeads({ active: true }), settings), (v) => { summary.outcomeRequests = v; });
  await job('costRetry', () => retryMissingCosts(settings), (v) => { summary.costsFilled = v; });
  await job('lowBalance', () => checkLowBalance(settings), (v) => { summary.lowBalanceAlert = v; });

  return summary;
}
