import { htmlPage } from '@/lib/http/page';
import { reassignLead } from '@/lib/leads/actions';
import { recordClick, verifyClick } from '@/lib/leads/verifyClick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/leads/[id]/reassign?value=<current designer id>&exp&sig — front desk reassigns (SPEC §12, §9). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const click = await verifyClick(req, id, 'reassign');
  if (click instanceof Response) return click;

  const r = await reassignLead(id, click.value);
  switch (r.status) {
    case 'not_found':
      return htmlPage('Lead not found', 'This lead no longer exists.', 404);
    case 'reassigned':
      await recordClick(id, 'lead_reassigned', { from: r.from, to: r.to, reassign_count: r.lead.reassign_count });
      return htmlPage('Lead reassigned', `Reassigned from ${r.from} to ${r.to}. They have been emailed the brief, and the 15/30-minute clock has restarted.`);
    case 'already_reassigned':
      await recordClick(id, 'click_ignored', { action: 'reassign', reason: 'already_reassigned' });
      return htmlPage('Already reassigned', 'This lead has already been reassigned. Nothing else to do.');
    case 'already_accepted':
      await recordClick(id, 'click_ignored', { action: 'reassign', reason: 'already_accepted' });
      return htmlPage('Already accepted', `${r.by ?? 'The designer'} has already accepted this lead, so it was not reassigned.`);
    case 'no_designer':
      await recordClick(id, 'click_ignored', { action: 'reassign', reason: 'no_designer' });
      return htmlPage('No one to reassign to', 'No other active designer is available. Please assign this lead by hand.', 409);
  }
}
