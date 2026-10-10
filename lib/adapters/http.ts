import type { FetchLike } from './types';

/** fetch + JSON with a clear error that includes the service name and status (body truncated). */
export async function requestJson<T>(
  service: string, fetchImpl: FetchLike, url: string, init: RequestInit,
): Promise<T> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${service} ${init.method ?? 'GET'} ${new URL(url).pathname} failed: ${res.status} ${text.slice(0, 300)}`);
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new Error(`${service} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}
