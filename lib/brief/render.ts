import { esc } from '@/lib/emails/html';
import { humanise } from '@/lib/format';
import { CRITERION_LABELS, type Brief } from './schema';

const STATUS_COLOUR = { met: '#1f6f4a', unclear: '#b7791f', not_met: '#c53030' } as const;

export function briefToText(b: Brief): string {
  const lines = [
    b.headline,
    '',
    b.what_they_want,
    '',
    'Criteria:',
    ...b.criteria.map((c) => `- ${CRITERION_LABELS[c.criterion]}: ${humanise(c.status)}${c.evidence ? ` — "${c.evidence}"` : ''}`),
  ];
  if (b.uncertainties.length) lines.push('', 'Uncertainties:', ...b.uncertainties.map((u) => `- ${u}`));
  if (b.caller_stated_budget) lines.push('', `Caller-stated budget (their words): ${b.caller_stated_budget}`);
  lines.push('', `Suggested opening: ${b.suggested_opening}`, b.booking);
  return lines.join('\n');
}

export function briefToHtml(b: Brief): string {
  const criteria = b.criteria
    .map((c) => `<li><strong>${esc(CRITERION_LABELS[c.criterion])}</strong>: <span style="color:${STATUS_COLOUR[c.status]}">${esc(humanise(c.status))}</span>${c.evidence ? ` — <em>"${esc(c.evidence)}"</em>` : ''}</li>`)
    .join('');
  const uncertainties = b.uncertainties.length
    ? `<p style="margin:12px 0 4px"><strong>Uncertainties</strong></p><ul style="margin:0">${b.uncertainties.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`
    : '';
  const budget = b.caller_stated_budget
    ? `<p><strong>Caller-stated budget (their words):</strong> ${esc(b.caller_stated_budget)}</p>`
    : '';
  return `<div style="border-left:4px solid #1f6f4a;padding:4px 0 4px 12px;margin:16px 0">
<p style="font-size:16px;font-weight:600;margin:0 0 8px">${esc(b.headline)}</p>
<p style="margin:0 0 8px">${esc(b.what_they_want)}</p>
<ul style="margin:0">${criteria}</ul>
${uncertainties}
${budget}
<p><strong>Suggested opening:</strong> ${esc(b.suggested_opening)}</p>
<p><strong>${esc(b.booking)}</strong></p>
</div>`;
}
