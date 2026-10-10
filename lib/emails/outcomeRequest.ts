import type { ConsultationOutcome, DesignerRow, LeadRow } from '@/lib/db/types';
import { button, esc, layout } from './html';

export const OUTCOME_LABELS: Record<ConsultationOutcome, string> = {
  site_visit: 'Site visit booked',
  proposal: 'Proposal requested',
  not_fit: 'Not a fit',
  no_show: 'No-show',
};

/** SPEC §12 Outcome request: four one-click buttons. */
export function outcomeRequestEmail({ lead, designer, links }: {
  lead: LeadRow; designer: DesignerRow; links: Record<ConsultationOutcome, string>;
}) {
  const who = lead.caller_name ?? 'this caller';
  const subject = `How did it go? · ${who} · ${lead.locality ?? 'locality not given'}`;
  const body = `Hi ${designer.name.split(' ')[0]}, how did it go with ${who}${lead.locality ? ` (${lead.locality})` : ''}? One click is enough.`;
  const entries = Object.entries(OUTCOME_LABELS) as [ConsultationOutcome, string][];
  const html = layout('How did it go?', `
<p>${esc(body)}</p>
<p>${entries.map(([v, label]) => button(links[v], label)).join('')}</p>`);
  const text = `${body}\n\n${entries.map(([v, label]) => `${label}: ${links[v]}`).join('\n')}\n`;
  return { subject, html, text };
}
