import { now } from '@/lib/clock';
import { getRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { htmlPage } from '@/lib/http/page';
import { verifyLink, type LinkAction } from '@/lib/links';

export interface VerifiedClick {
  leadId: string;
  value: string;
}

/**
 * Verify the signed link on a click endpoint. On failure, record a `link_rejected` event and return the error page.
 * Every click — good or bad — writes exactly one event (SPEC §12).
 */
export async function verifyClick(req: Request, leadId: string, action: LinkAction): Promise<VerifiedClick | Response> {
  const q = new URL(req.url).searchParams;
  const value = q.get('value') ?? undefined;
  const exp = Number(q.get('exp'));
  const sig = q.get('sig') ?? '';
  const result = verifyLink({ leadId, action, value, exp, sig }, env().LINK_SIGNING_SECRET, now());
  if (result.ok && value) return { leadId, value };

  const reason = result.ok ? 'malformed' : result.reason;
  const lead = await getRepo().getLead(leadId).catch(() => null);
  await getRepo().insertEvent({ type: 'link_rejected', lead_id: lead?.id ?? null, meta: { action, reason, lead_id: leadId } });
  return reason === 'expired'
    ? htmlPage('Link expired', 'This link has expired. Please contact the front desk.', 403)
    : htmlPage('Link not valid', 'This link is not valid. Please use the button in the most recent email.', 403);
}

export const recordClick = (leadId: string, type: string, meta: Record<string, string | number | null>) =>
  getRepo().insertEvent({ type, lead_id: leadId, meta });
