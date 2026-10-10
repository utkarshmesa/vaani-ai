import { describe, expect, it } from 'vitest';
import { designerBriefEmail } from '@/lib/emails/designerBrief';
import { reminderEmail } from '@/lib/emails/reminder';
import { escalationEmail } from '@/lib/emails/escalation';
import { outcomeRequestEmail } from '@/lib/emails/outcomeRequest';
import { lowBalanceEmail } from '@/lib/emails/lowBalance';
import { urgentEmail } from '@/lib/emails/urgent';
import { scanText } from '@/lib/priceScan';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import type { CallRow, LeadRow } from '@/lib/db/types';
import { VALID_BRIEF } from '../brief/validBrief';

const designer = SEED_DESIGNERS[0];
const lead: LeadRow = {
  id: 'lead-1', call_id: 'call-1', caller_name: 'Priya', enquiry_type: 'new_enquiry', locality: 'Kothrud', in_service_area: 'yes',
  property_type: 'independent_house', carpet_area_sqft: 1400, scope: 'Kitchen, living room', completion_deadline: 'By March',
  timeline_fit: 'yes', decision_maker: 'yes', budget_mentioned: 'none', outcome: 'booked', decline_reason: null,
  callback_preference: null, notes_for_designer: 'Referred by Shruti.', booked_slot_start: '2026-09-07T05:30:00.000Z',
  booking_confirmed: true, cal_booking_uid: 'b1', designer_id: designer.id, brief_json: null, brief_text: null,
  clock_started_at: '2026-09-02T04:57:40.000Z', email_sent_at: '2026-09-02T04:57:40.000Z', reminder_sent_at: null,
  escalated_at: null, accepted_at: null, reassign_count: 0, consultation_outcome: null, outcome_requested_at: null,
  outcome_logged_at: null, needs_attention: false, attention_reason: null, created_at: '2026-09-02T04:57:40.000Z',
};
const call = { call_id: 'call-1', received_at: '2026-09-02T04:57:40.000Z', from_number: '+919800000101', summary: 'Priya wants a full redesign.' } as CallRow;
const ACCEPT = 'http://localhost:3000/api/leads/lead-1/accept?value=d&exp=1&sig=s';
const REASSIGN = 'http://localhost:3000/api/leads/lead-1/reassign?value=d&exp=1&sig=s';

const noMoney = (e: { subject: string; text: string; html: string }) => {
  expect(scanText(e.subject).flag).toBe(false);
  expect(scanText(e.text)).toEqual({ flag: false, lines: [] });
};

describe('designer brief email', () => {
  it('has the §12 subject, the brief, the caller number and a big Accept button', () => {
    const e = designerBriefEmail({ lead, designer, acceptUrl: ACCEPT, callerNumber: '+919800000101', brief: VALID_BRIEF });
    expect(e.subject).toBe('New lead · Kothrud · independent house · Mon 7 Sep, 11:00 am');
    expect(e.text).toContain(VALID_BRIEF.what_they_want);
    expect(e.text).toContain('Suggested opening: What do you like least');
    expect(e.text).toContain('+919800000101');
    expect(e.text).toContain(`Accept this lead: ${ACCEPT}`);
    expect(e.html).toContain(`href="${ACCEPT.replace(/&/g, '&amp;')}"`);
    expect(e.html).toContain('Accept this lead');
    noMoney(e);
  });

  it('still carries the lead details without a brief', () => {
    const e = designerBriefEmail({ lead, designer, acceptUrl: ACCEPT, callerNumber: null, brief: null });
    expect(e.text).toContain('Scope: Kitchen, living room');
    expect(e.text).toContain('Brief not available');
  });

  it('says when a lead was reassigned', () => {
    const e = designerBriefEmail({ lead, designer, acceptUrl: ACCEPT, callerNumber: null, brief: VALID_BRIEF, reassignedFrom: 'Rohan Joshi' });
    expect(e.text).toContain('Reassigned to you from Rohan Joshi');
  });

  it('shows the caller-stated budget only when present, attributed', () => {
    const e = designerBriefEmail({ lead, designer, acceptUrl: ACCEPT, callerNumber: null, brief: { ...VALID_BRIEF, caller_stated_budget: '18 to 22 lakh' } });
    expect(e.text).toContain('Caller-stated budget (their words): 18 to 22 lakh');
  });

  it('escapes HTML in caller-supplied text', () => {
    const e = designerBriefEmail({ lead: { ...lead, caller_name: '<script>x</script>' }, designer, acceptUrl: ACCEPT, callerNumber: null, brief: null });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
  });
});

describe('reminder email (+15 working minutes)', () => {
  it('is about the same lead and says "still waiting for you"', () => {
    const e = reminderEmail({ lead, designer, acceptUrl: ACCEPT, minutesWaiting: 15 });
    expect(e.subject).toBe('Still waiting for you · New lead · Kothrud · independent house · Mon 7 Sep, 11:00 am');
    expect(e.text).toMatch(/still waiting for you/i);
    expect(e.text).toContain(ACCEPT);
    noMoney(e);
  });
});

describe('escalation email (+30 working minutes, to the front desk)', () => {
  it('has a lead summary, the designer name and a Reassign button', () => {
    const e = escalationEmail({ lead, designer, reassignUrl: REASSIGN, minutesWaiting: 30, callerNumber: '+919800000101', dashboardUrl: 'http://localhost:3000/dashboard' });
    expect(e.subject).toBe('Not accepted in 30 min · Ananya Kulkarni · Kothrud · Priya');
    expect(e.text).toContain('Ananya Kulkarni has not accepted');
    expect(e.text).toContain('Kitchen, living room');
    expect(e.text).toContain('+919800000101');
    expect(e.text).toContain(`Reassign to the next designer: ${REASSIGN}`);
    expect(e.html).toContain('Reassign');
    noMoney(e);
  });
});

describe('outcome request email', () => {
  it('has four one-click buttons', () => {
    const links = { site_visit: 'u1', proposal: 'u2', not_fit: 'u3', no_show: 'u4' };
    const e = outcomeRequestEmail({ lead, designer, links });
    expect(e.subject).toBe('How did it go? · Priya · Kothrud');
    for (const [label, url] of [['Site visit booked', 'u1'], ['Proposal requested', 'u2'], ['Not a fit', 'u3'], ['No-show', 'u4']]) {
      expect(e.html).toContain(`href="${url}"`);
      expect(e.html).toContain(label);
      expect(e.text).toContain(`${label}: ${url}`);
    }
    noMoney(e);
  });
});

describe('low balance email (to the owner)', () => {
  it('states credits remaining and the threshold', () => {
    const e = lowBalanceEmail({ remainingCredits: 87.5, thresholdCredits: 100, creditsLoaded: 1000, dashboardUrl: 'http://localhost:3000/dashboard' });
    expect(e.subject).toBe('Vaani credits low · 87.5 left');
    expect(e.text).toContain('87.5 of 1000 credits remain');
    expect(e.text).toContain('below your alert threshold of 100');
    noMoney(e);
  });
});

describe('urgent email', () => {
  it('passes the price scanner', () => {
    noMoney(urgentEmail('transfer_failed', lead, call, 'http://localhost:3000/dashboard'));
  });
});
