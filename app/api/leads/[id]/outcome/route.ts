import { OUTCOME_LABELS } from '@/lib/emails/outcomeRequest';
import { htmlPage } from '@/lib/http/page';
import { isConsultationOutcome, logOutcome } from '@/lib/leads/actions';
import { recordClick, verifyClick } from '@/lib/leads/verifyClick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/leads/[id]/outcome?value=<site_visit|proposal|not_fit|no_show>&exp&sig (SPEC §12). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const click = await verifyClick(req, id, 'outcome');
  if (click instanceof Response) return click;

  const r = await logOutcome(id, click.value);
  switch (r.status) {
    case 'not_found':
      return htmlPage('Lead not found', 'This lead no longer exists.', 404);
    case 'invalid_value':
      await recordClick(id, 'click_ignored', { action: 'outcome', reason: 'invalid_value', value: click.value });
      return htmlPage('Unknown outcome', 'That outcome is not recognised.', 400);
    case 'logged': {
      const label = isConsultationOutcome(click.value) ? OUTCOME_LABELS[click.value] : click.value;
      await recordClick(id, 'outcome_logged', { value: click.value });
      return htmlPage('Outcome recorded', `Recorded: ${label}. Thank you.`);
    }
  }
}
