import { Resend } from 'resend';
import type { ResendAdapter } from './types';

/** The slice of the Resend SDK we use — injectable for tests. */
export interface ResendClient {
  emails: {
    send(payload: {
      from: string; to: string; subject: string; html: string; text: string; tags?: { name: string; value: string }[];
    }): Promise<{ data: { id: string } | null; error: { name?: string; message: string } | null }>;
  };
}

export function createResendAdapter(opts: { apiKey: string; from: string; client?: ResendClient }): ResendAdapter {
  const client: ResendClient = opts.client ?? (new Resend(opts.apiKey) as unknown as ResendClient);

  return {
    async send(email) {
      const { data, error } = await client.emails.send({
        from: opts.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [{ name: 'type', value: email.tag }],
      });
      if (error || !data) throw new Error(`Resend send failed: ${error?.name ?? 'unknown'} ${error?.message ?? 'no data'}`);
      return { id: data.id };
    },
  };
}
