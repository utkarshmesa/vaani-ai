export type Speaker = 'AGENT' | 'USER' | 'OTHER';

export interface TranscriptLine {
  speaker: Speaker;
  /** "HH:MM:SS" from the webhook format, if present. */
  time: string | null;
  text: string;
}

/**
 * Vaani transcripts come in two shapes (NOTES.md §1.2):
 *   webhook:      "[13:33:14] AGENT: Hi!\n\n[13:33:19] USER: …"
 *   call details: "AGENT: Hi!\n\n USER: …"
 */
const LINE = /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(AGENT|USER)\s*:\s?(.*)$/i;

export function parseTranscript(transcript: string | null | undefined): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const raw of (transcript ?? '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = raw.match(LINE);
    if (m) {
      out.push({ speaker: m[2].toUpperCase() as Speaker, time: m[1] ?? null, text: m[3].trim() });
    } else if (out.length) {
      out[out.length - 1].text = `${out[out.length - 1].text} ${raw.trim()}`.trim();
    } else {
      out.push({ speaker: 'OTHER', time: null, text: raw.trim() });
    }
  }
  return out;
}

export function agentLines(transcript: string | null | undefined): string[] {
  return parseTranscript(transcript).filter((l) => l.speaker === 'AGENT').map((l) => l.text);
}
