import { describe, expect, it } from 'vitest';
import { buildLinkUrl, signLink, verifyLink } from '@/lib/links';
import { safeEqual } from '@/lib/crypto';

const SECRET = 'test-link-signing-secret-0123456789';
const LEAD = '7b0c8f0e-2f1a-4d3b-9a55-0c1d2e3f4a5b';
const NOW = new Date('2026-09-07T05:30:00Z');
const exp = Math.floor(NOW.getTime() / 1000) + 3600;

describe('signLink / verifyLink', () => {
  it('round-trips a valid link', () => {
    const sig = signLink({ leadId: LEAD, action: 'accept', exp }, SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url SHA-256
    expect(verifyLink({ leadId: LEAD, action: 'accept', exp, sig }, SECRET, NOW)).toEqual({ ok: true });
  });

  it('binds the value for outcome links', () => {
    const sig = signLink({ leadId: LEAD, action: 'outcome', value: 'site_visit', exp }, SECRET);
    expect(verifyLink({ leadId: LEAD, action: 'outcome', value: 'site_visit', exp, sig }, SECRET, NOW).ok).toBe(true);
    expect(verifyLink({ leadId: LEAD, action: 'outcome', value: 'proposal', exp, sig }, SECRET, NOW))
      .toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a different lead, action, expiry or secret', () => {
    const sig = signLink({ leadId: LEAD, action: 'accept', exp }, SECRET);
    const bad = { ok: false, reason: 'bad_signature' };
    expect(verifyLink({ leadId: 'other', action: 'accept', exp, sig }, SECRET, NOW)).toEqual(bad);
    expect(verifyLink({ leadId: LEAD, action: 'reassign', exp, sig }, SECRET, NOW)).toEqual(bad);
    expect(verifyLink({ leadId: LEAD, action: 'accept', exp: exp + 1, sig }, SECRET, NOW)).toEqual(bad);
    expect(verifyLink({ leadId: LEAD, action: 'accept', exp, sig }, 'another-secret-0123456789', NOW)).toEqual(bad);
  });

  it('rejects an expired link (checked after the signature)', () => {
    const past = Math.floor(NOW.getTime() / 1000) - 1;
    const sig = signLink({ leadId: LEAD, action: 'accept', exp: past }, SECRET);
    expect(verifyLink({ leadId: LEAD, action: 'accept', exp: past, sig }, SECRET, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyLink({ leadId: LEAD, action: 'accept', exp: Number.NaN, sig: 'x' }, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyLink({ leadId: LEAD, action: 'accept', exp, sig: '' }, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyLink({ leadId: LEAD, action: 'accept', exp, sig: 'short' }, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('buildLinkUrl', () => {
  it('builds a verifiable click URL', () => {
    const url = new URL(buildLinkUrl('http://localhost:3000', { leadId: LEAD, action: 'outcome', value: 'no_show', exp }, SECRET));
    expect(url.pathname).toBe(`/api/leads/${LEAD}/outcome`);
    expect(url.searchParams.get('value')).toBe('no_show');
    const parsed = {
      leadId: LEAD, action: 'outcome' as const, value: url.searchParams.get('value') ?? undefined,
      exp: Number(url.searchParams.get('exp')), sig: url.searchParams.get('sig') ?? '',
    };
    expect(verifyLink(parsed, SECRET, NOW)).toEqual({ ok: true });
  });

  it('omits value when not given', () => {
    const url = new URL(buildLinkUrl('https://leads.example.app/', { leadId: LEAD, action: 'accept', exp }, SECRET));
    expect(url.origin + url.pathname).toBe(`https://leads.example.app/api/leads/${LEAD}/accept`);
    expect(url.searchParams.has('value')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares strings without leaking length or content through early exit', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false); // an unset secret never matches
    expect(safeEqual(null, 'abc')).toBe(false);
    expect(safeEqual('abc', undefined)).toBe(false);
  });
});
