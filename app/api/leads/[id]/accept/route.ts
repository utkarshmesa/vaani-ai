import { htmlPage } from '@/lib/http/page';
import { acceptLead } from '@/lib/leads/actions';
import { recordClick, verifyClick } from '@/lib/leads/verifyClick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/leads/[id]/accept?value=<designer id>&exp&sig — the designer accepts the lead (SPEC §12). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const click = await verifyClick(req, id, 'accept');
  if (click instanceof Response) return click;

  const r = await acceptLead(id, click.value);
  switch (r.status) {
    case 'not_found':
      return htmlPage('Lead not found', 'This lead no longer exists.', 404);
    case 'accepted':
      await recordClick(id, 'lead_accepted', { designer_id: click.value });
      return htmlPage('Lead accepted', `Thank you. ${r.lead.caller_name ?? 'The caller'} is yours — the studio has been told. Please call them as soon as you can.`);
    case 'already_accepted':
      await recordClick(id, 'click_ignored', { action: 'accept', reason: 'already_accepted' });
      return htmlPage('Already accepted', 'You have already accepted this lead. Nothing else to do.');
    case 'reassigned_away':
      await recordClick(id, 'click_ignored', { action: 'accept', reason: 'reassigned', designer_id: click.value });
      return htmlPage('Lead reassigned', `This lead has been reassigned to ${r.currentDesigner ?? 'another designer'}. No action needed.`, 409);
  }
}
