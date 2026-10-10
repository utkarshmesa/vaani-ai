import { describe, expect, it } from 'vitest';
import { scanAgentLines, scanText } from '@/lib/priceScan';
import { APPROVED_PRICE_RESPONSE } from '@/lib/priceScan';

const agent = (s: string) => `[10:00:00] AGENT: ${s}`;
const user = (s: string) => `[10:00:05] USER: ${s}`;

describe('scanText — SPEC §10 money terms are flagged', () => {
  it.each([
    ['₹', 'That would be ₹2,000 for this.'],
    ['rs', 'It is about 2000 rs.'],
    ['rs.', 'Rs. 5000 onwards.'],
    ['rupee', 'Each rupee counts.'],
    ['rupees', 'A few thousand rupees.'],
    ['lakh', 'Around five lakh.'],
    ['lakhs', 'Several lakhs.'],
    ['lac', 'About 5 lac.'],
    ['crore', 'Not even a crore.'],
    ['per sq', 'It is 1800 per sq ft.'],
    ['per square', 'Per square foot it varies.'],
    ['/sq', 'Roughly 2000/sqft.'],
    ['rate', 'Our rate is fixed.'],
    ['rates', 'Our rates are standard.'],
    ['costs around', 'It costs around that much.'],
    ['starting at', 'Projects starting at a modest figure.'],
    ['starts at', 'Design starts at a fixed fee.'],
    ['ballpark', 'In the ballpark of what you said.'],
  ])('%s', (_term, line) => {
    expect(scanText(line).flag).toBe(true);
  });

  it.each([
    ['rupaye (romanised Hindi)', 'Lagbhag do hazaar rupaye per square foot.'],
    ['रुपये', 'यह 2000 रुपये होगा।'],
    ['लाख', 'लगभग पाँच लाख।'],
    ['करोड़', 'एक करोड़।'],
    ['प्रति वर्ग', '2000 प्रति वर्ग फुट।'],
  ])('Hindi extension: %s', (_term, line) => {
    expect(scanText(line).flag).toBe(true);
  });
});

describe('scanText — not flagged', () => {
  it.each([
    'Your 1,400 sq ft flat in Kothrud sounds lovely.',
    'About 950 square feet, got it.',
    'I have booked you for Monday 7 September at 11:00 am.',
    'The slot starting at 11 am on Monday is free.',
    'Your consultation starts at 4:30 pm.',
    'It starts at 10.',
    'We are open these hours: 10 to 7.',
    'Is this your first project? Yours sounds exciting.',
    'Mrs Mehta, thank you.',
    'That place is in our service area.',
    'Let me be accurate about the separate rooms.',
    'Our corporate clients are offices and clinics.',
    'Design usually takes three to four weeks.',
    'The budget you mentioned would be well below what a project of that scope costs with us, so I wouldn\'t want to bring you to a consultation that doesn\'t work for you.',
    APPROVED_PRICE_RESPONSE,
  ])('%s', (line) => {
    expect(scanText(line)).toEqual({ flag: false, lines: [] });
  });
});

describe('scanAgentLines', () => {
  it('only scans AGENT lines — the caller may say anything', () => {
    const t = [
      user('My budget is 1 to 1.5 lakh. What is your rate per sq ft?'),
      agent(APPROVED_PRICE_RESPONSE),
      user('Even a ballpark? In rupees?'),
      agent('Any number now could be far off. The consultation is free, and your designer gives a proper figure at the end of it.'),
    ].join('\n\n');
    expect(scanAgentLines(t)).toEqual({ flag: false, lines: [] });
  });

  it('returns each offending agent line once, verbatim', () => {
    const leak = 'For a flat like yours we usually charge 1,800 per sq ft.';
    const t = [agent('Namaste.'), user('How much?'), agent(leak), agent('Starting at 2 lakh.')].join('\n\n');
    expect(scanAgentLines(t)).toEqual({ flag: true, lines: [leak, 'Starting at 2 lakh.'] });
  });

  it('handles an empty transcript', () => {
    expect(scanAgentLines('')).toEqual({ flag: false, lines: [] });
  });
});

describe('scanText on multi-line text (briefs)', () => {
  it('reports the offending lines only', () => {
    const r = scanText('Headline: Priya · Kothrud · apartment\nTypical cost: 20 lakh\nBooked Monday 11 am');
    expect(r).toEqual({ flag: true, lines: ['Typical cost: 20 lakh'] });
  });
});
