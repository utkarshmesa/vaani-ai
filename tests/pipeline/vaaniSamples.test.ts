import { describe, expect, it } from 'vitest';
import { processEvent } from '@/lib/pipeline/processEvent';
import { readEvent } from '@/lib/pipeline/payload';
import { parseTranscript } from '@/lib/transcript';
import { getRepo } from '@/lib/db';
import { setNow } from '@/lib/clock';
import { loadFixture } from '../helpers';

/**
 * Shapes captured from Vaani's own "Test Connectivity" webhook (2026-10-10, NOTES.md). Unlike the docs, transfer
 * and call_started events nest their fields under `data`; the transcript uses "Agent:"/"User:" without timestamps.
 */
const ts = '2026-10-10T18:30:40.561404+00:00';
const callStarted = {
  event: 'call_started', timestamp: ts,
  data: { call_id: 'test_room_123', call_type: 'Outbound', room_name: 'test_room_123', agent_name: 'TestAgent', phone_number: '+919876543210' },
};
const transferFailed = {
  event: 'human_transfer_failed', timestamp: ts,
  data: { reason: 'NO_ANSWER', room_name: 'test_room_123', sip_status: '408', agent_identity: 'agent-sip-identity' },
};
const transferOk = { event: 'human_transfer_successful', timestamp: ts, data: { room_name: 'test_room_123', agent_identity: 'agent-sip-identity' } };
const webhookTest = { event: 'webhook_test', events: [callStarted, transferFailed, transferOk] };

describe('real Vaani webhook shapes', () => {
  it('reads call ids from data for call_started and transfer events', () => {
    expect(readEvent(callStarted)).toMatchObject({ event: 'call_started', callId: 'test_room_123' });
    expect(readEvent(transferFailed)).toMatchObject({ event: 'human_transfer_failed', callId: 'test_room_123' });
    expect(readEvent(transferOk)).toMatchObject({ event: 'human_transfer_successful', callId: 'test_room_123' });
  });

  it('records the caller number from a nested call_started', async () => {
    await processEvent(callStarted);
    const ev = await getRepo().listEvents({ callId: 'test_room_123', type: 'caller_number' });
    expect(ev[0].meta).toMatchObject({ phone_number: '+919876543210' });
  });

  it('records the transfer reason from a nested human_transfer_failed', async () => {
    await processEvent(transferFailed);
    const ev = await getRepo().listEvents({ callId: 'test_room_123', type: 'transfer_failed' });
    expect(ev[0].meta).toMatchObject({ reason: 'NO_ANSWER', sip_status: '408' });
  });

  it('a nested transfer failure overrides existing_client_transferred, as with the documented shape', async () => {
    const p = loadFixture('t09');
    setNow(p.timestamp);
    await processEvent({ ...transferFailed, data: { ...transferFailed.data, room_name: p.call_id } });
    await processEvent(p, { lookupDelayMs: 0 });
    expect((await getRepo().getLeadByCallId(p.call_id))?.outcome).toBe('transfer_failed');
  });

  it('ignores the "webhook_test" wrapper sent by Test Connectivity', async () => {
    expect(await processEvent(webhookTest)).toEqual({ kind: 'ignored', event: 'webhook_test' });
  });

  it('parses the "Agent:"/"User:" transcript style', () => {
    expect(parseTranscript('Agent: Hello\nUser: Hi')).toEqual([
      { speaker: 'AGENT', time: null, text: 'Hello' },
      { speaker: 'USER', time: null, text: 'Hi' },
    ]);
  });
});
