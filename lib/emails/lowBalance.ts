import { esc, layout } from './html';

/** SPEC §12 Low balance → OWNER_EMAIL. */
export function lowBalanceEmail({ remainingCredits, thresholdCredits, creditsLoaded, dashboardUrl }: {
  remainingCredits: number; thresholdCredits: number; creditsLoaded: number; dashboardUrl: string;
}) {
  const remaining = Math.round(remainingCredits * 100) / 100;
  const subject = `Vaani credits low · ${remaining} left`;
  const body = `${remaining} of ${creditsLoaded} credits remain, below your alert threshold of ${thresholdCredits}. Top up in the Vaani dashboard so calls keep being answered, then update credits_loaded in settings.`;
  const html = layout('Vaani credits are running low', `<p>${esc(body)}</p><p><a href="${esc(dashboardUrl)}">Open the dashboard</a></p>`);
  const text = `${body}\n\nDashboard: ${dashboardUrl}\n`;
  return { subject, html, text };
}
