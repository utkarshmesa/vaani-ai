import { requestJson } from './http';
import type { FetchLike, VaaniAdapter, VaaniCallHistoryItem } from './types';

const BASE_URL = 'https://api.vaanivoice.ai';
const PAGE_SIZE = 200; // documented maximum

interface RawHistoryRow {
  call_id: string;
  call_type?: string;
  from_number?: string | null;
  to_number?: string | null;
  Start_time?: string | null;
  call_cost?: number | null;
  post_processing_status?: string;
}

interface RawHistoryPage {
  data?: RawHistoryRow[];
  pagination?: { has_next?: boolean };
}

export function createVaaniAdapter(opts: { apiKey: string; baseUrl?: string; fetch?: FetchLike }): VaaniAdapter {
  const base = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetch ?? fetch;
  const headers = { 'X-API-Key': opts.apiKey, 'Content-Type': 'application/json' };

  const patch = (agentId: string, section: string, body: unknown) =>
    requestJson('Vaani', fetchImpl, `${base}/api/agent/${encodeURIComponent(agentId)}/${section}`, {
      method: 'PATCH', headers, body: JSON.stringify(body),
    });

  /** call-history has no call_id or date filter (NOTES.md §1.4): page through until every id is found. */
  async function scan(callIds: string[], maxPages: number): Promise<Map<string, VaaniCallHistoryItem>> {
    const wanted = new Set(callIds);
    const found = new Map<string, VaaniCallHistoryItem>();
    for (let page = 1; page <= maxPages && found.size < wanted.size; page++) {
      const res = await requestJson<RawHistoryPage>('Vaani', fetchImpl,
        `${base}/api/call-history?page=${page}&page_size=${PAGE_SIZE}`, { method: 'GET', headers });
      for (const row of res?.data ?? []) if (wanted.has(row.call_id)) found.set(row.call_id, normalise(row));
      if (!res?.pagination?.has_next) break;
    }
    return found;
  }

  return {
    async findCall(callId, { maxPages = 3 } = {}) {
      return (await scan([callId], maxPages)).get(callId) ?? null;
    },
    findCalls: (callIds, { maxPages = 5 } = {}) => scan(callIds, maxPages),
    updatePersona: (agentId, body) => patch(agentId, 'persona', body),
    updateTraining: (agentId, body) => patch(agentId, 'training', body),
    updateExperience: (agentId, body) => patch(agentId, 'experience', body),
    updateAnalysis: (agentId, body) => patch(agentId, 'analysis', body),
  };
}

function normalise(r: RawHistoryRow): VaaniCallHistoryItem {
  return {
    call_id: r.call_id,
    call_type: r.call_type ?? '',
    from_number: r.from_number ?? null,
    to_number: r.to_number ?? null,
    start_time: r.Start_time ?? null,
    call_cost: typeof r.call_cost === 'number' ? r.call_cost : null,
    post_processing_status: r.post_processing_status ?? '',
  };
}
