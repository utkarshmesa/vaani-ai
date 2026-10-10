import { describe, expect, it } from 'vitest';
import { agentLines, parseTranscript } from '@/lib/transcript';

describe('parseTranscript', () => {
  it('parses the webhook format with [HH:MM:SS] prefixes and blank-line separators', () => {
    const t = '[13:33:14] AGENT: Hi! How can I help?\n\n[13:33:19] USER: Yeah. What can you do?\n\n[13:33:31] AGENT: Quite a lot.';
    expect(parseTranscript(t)).toEqual([
      { speaker: 'AGENT', time: '13:33:14', text: 'Hi! How can I help?' },
      { speaker: 'USER', time: '13:33:19', text: 'Yeah. What can you do?' },
      { speaker: 'AGENT', time: '13:33:31', text: 'Quite a lot.' },
    ]);
  });

  it('parses the call-details format with leading spaces and no timestamps', () => {
    const t = 'AGENT: Namaste.\n\n USER: Hello.\n\n AGENT: How can I help?';
    expect(parseTranscript(t).map((l) => [l.speaker, l.text])).toEqual([
      ['AGENT', 'Namaste.'], ['USER', 'Hello.'], ['AGENT', 'How can I help?'],
    ]);
  });

  it('joins continuation lines to the previous turn', () => {
    const t = 'AGENT: First part\nsecond part\r\nUSER: ok';
    expect(parseTranscript(t)).toEqual([
      { speaker: 'AGENT', time: null, text: 'First part second part' },
      { speaker: 'USER', time: null, text: 'ok' },
    ]);
  });

  it('is case-insensitive about speaker labels and handles empty input', () => {
    expect(parseTranscript('agent: hi\nUser: yo').map((l) => l.speaker)).toEqual(['AGENT', 'USER']);
    expect(parseTranscript('')).toEqual([]);
    expect(parseTranscript(null)).toEqual([]);
  });

  it('keeps unlabelled leading text as OTHER rather than attributing it to the agent', () => {
    expect(parseTranscript('(call connected)\nAGENT: hi')[0]).toEqual({ speaker: 'OTHER', time: null, text: '(call connected)' });
  });
});

describe('agentLines', () => {
  it('returns only what the agent said', () => {
    expect(agentLines('[1:00:00] AGENT: a\n\n[1:00:01] USER: b\n\n[1:00:02] AGENT: c')).toEqual(['a', 'c']);
  });
});
