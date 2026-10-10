import { readFileSync } from 'node:fs';

export const FIXTURE_NAMES = ['t01', 't13', 't10', 't09', 't09_failed', 't17', 'price_leak'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface FixturePayload {
  event: string;
  call_id: string;
  timestamp: string;
  data: {
    room_name: string;
    call_id: string;
    call_duration: number;
    summary: string;
    entities: Record<string, unknown>;
    dispositions: Record<string, unknown>;
    recording_url: string;
    transcript: string;
    [k: string]: unknown;
  };
}

/** A fresh deep copy of fixtures/<name>.json. */
export function loadFixture(name: FixtureName): FixturePayload {
  return JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8'));
}

export function loadTransferEvent(name: 't09_failed'): Record<string, unknown> {
  return JSON.parse(readFileSync(`fixtures/${name}.transfer.json`, 'utf8'));
}

/** The fixture's postprocessing time — tests pin the clock here. */
export const fixtureTime = (name: FixtureName) => loadFixture(name).timestamp;
