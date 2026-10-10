import { createHmac } from 'node:crypto';
import { safeEqual } from '@/lib/crypto';

/** One-click actions in emails (SPEC §12). */
export type LinkAction = 'accept' | 'outcome' | 'reassign';

export interface LinkParams {
  leadId: string;
  action: LinkAction;
  /** e.g. the consultation outcome for `outcome` links */
  value?: string;
  /** Expiry, unix seconds */
  exp: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/** HMAC-SHA256 over lead id + action + value + expiry, base64url. */
export function signLink(p: LinkParams, secret: string): string {
  return createHmac('sha256', secret)
    .update([p.leadId, p.action, p.value ?? '', String(p.exp)].join('\n'))
    .digest('base64url');
}

export function verifyLink(p: LinkParams & { sig: string }, secret: string, now: Date): VerifyResult {
  if (!p.leadId || !p.sig || !Number.isInteger(p.exp)) return { ok: false, reason: 'malformed' };
  if (!safeEqual(signLink(p, secret), p.sig)) return { ok: false, reason: 'bad_signature' };
  if (p.exp * 1000 < now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** `${base}/api/leads/{id}/{action}?value=…&exp=…&sig=…` */
export function buildLinkUrl(baseUrl: string, p: LinkParams, secret: string): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/leads/${encodeURIComponent(p.leadId)}/${p.action}`);
  if (p.value !== undefined) url.searchParams.set('value', p.value);
  url.searchParams.set('exp', String(p.exp));
  url.searchParams.set('sig', signLink(p, secret));
  return url.toString();
}
