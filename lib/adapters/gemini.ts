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

export function createGeminiAdapter(opts: { apiKey: string; model: string; client?: GenAiClient }): GeminiAdapter {
  const client: GenAiClient = opts.client ?? (new GoogleGenAI({ apiKey: opts.apiKey }) as unknown as GenAiClient);

  return {
    async generateJson({ system, prompt, jsonSchema }) {
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
    },
  };
}
