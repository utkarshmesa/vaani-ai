import { GoogleGenAI } from '@google/genai';
import type { GeminiAdapter } from './types';

/** The slice of the @google/genai client we use — injectable for tests. */
export interface GenAiClient {
  models: {
    generateContent(req: {
      model: string;
      contents: string;
      config: Record<string, unknown>;
    }): Promise<{
      text?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    }>;
  };
}

/** GEMINI_API_KEY may hold several comma-separated keys; later ones are fallbacks. */
export function geminiKeys(value: string): string[] {
  return value.split(',').map((k) => k.trim()).filter(Boolean);
}

/** Errors worth retrying with another key: bad/expired key, quota, or a server-side failure. */
const FALLBACK_STATUSES = new Set([401, 403, 429, 500, 502, 503, 504]);
function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown; code?: unknown })?.status ?? (err as { code?: unknown })?.code;
  return typeof s === 'number' ? s : null;
}

export function createGeminiAdapter(opts: {
  apiKey: string;
  model: string;
  /** Test seam: one client for the single-key case… */
  client?: GenAiClient;
  /** …or one per key. */
  clients?: GenAiClient[];
}): GeminiAdapter {
  const clients: GenAiClient[] = opts.clients
    ?? (opts.client ? [opts.client] : geminiKeys(opts.apiKey).map((apiKey) => new GoogleGenAI({ apiKey }) as unknown as GenAiClient));
  if (clients.length === 0) throw new Error('GEMINI_API_KEY is empty');

  return {
    async generateJson({ system, prompt, jsonSchema }) {
      let lastError: unknown;
      for (const client of clients) {
        try {
          const res = await client.models.generateContent({
            model: opts.model,
            contents: prompt,
            config: {
              systemInstruction: system,
              responseMimeType: 'application/json',
              responseJsonSchema: jsonSchema,
              temperature: 0.2,
              // Thinking tokens are billed as output; a brief doesn't need much reasoning.
              thinkingConfig: { thinkingBudget: 512 },
            },
          });
          const u = res.usageMetadata ?? {};
          return {
            text: res.text ?? '',
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          };
        } catch (err) {
          lastError = err;
          const status = statusOf(err);
          if (status === null || !FALLBACK_STATUSES.has(status)) throw err;
        }
      }
      throw lastError;
    },
  };
}
