import { now } from '@/lib/clock';
import type { ConsultationOutcome } from '@/lib/db/types';
import { env } from '@/lib/env';
import { buildLinkUrl, type LinkAction } from '@/lib/links';

/** How long each kind of emailed link stays valid. */
export const LINK_TTL_DAYS: Record<LinkAction, number> = { accept: 14, reassign: 7, outcome: 30 };

function link(leadId: string, action: LinkAction, value: string): string {
  const e = env();
  const exp = Math.floor(now().getTime() / 1000) + LINK_TTL_DAYS[action] * 86_400;
  return buildLinkUrl(e.APP_BASE_URL, { leadId, action, value, exp }, e.LINK_SIGNING_SECRET);
}

/** Bound to the designer it was sent to, so it stops working if the lead is reassigned. */
export const acceptLink = (leadId: string, designerId: string) => link(leadId, 'accept', designerId);

/** Bound to the designer being replaced, so a second click can't reassign twice. */
export const reassignLink = (leadId: string, currentDesignerId: string) => link(leadId, 'reassign', currentDesignerId);

export const outcomeLink = (leadId: string, value: ConsultationOutcome) => link(leadId, 'outcome', value);
