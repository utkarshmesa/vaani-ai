import { describe, expect, it } from 'vitest';
import { isCompleteRecord, mapEntities } from '@/lib/mapEntities';

const booked = {
  caller_name: 'Priya',
  enquiry_type: 'new_enquiry',
  locality: 'Kothrud — Dahanukar Colony',
  in_service_area: 'yes',
  property_type: 'apartment',
  carpet_area_sqft: '1400',
  scope: 'Full home: kitchen, living room, both bedrooms',
  completion_deadline: 'by March',
  timeline_fit: 'yes',
  decision_maker: 'yes',
  budget_mentioned: 'none',
  outcome: 'booked',
  decline_reason: null,
  booked_slot_iso: '2026-09-07T11:00:00+05:30',
  callback_preference: null,
  notes_for_designer: 'Referred by Shruti Joshi (Aundh client).',
};

describe('mapEntities', () => {
  it('maps a complete booked enquiry', () => {
    const r = mapEntities(booked);
    expect(r.outcome).toBe('booked');
    expect(r.problems).toEqual([]);
    expect(r.fields).toEqual({
      caller_name: 'Priya',
      enquiry_type: 'new_enquiry',
      locality: 'Kothrud — Dahanukar Colony',
      in_service_area: 'yes',
      property_type: 'apartment',
      carpet_area_sqft: 1400,
      scope: 'Full home: kitchen, living room, both bedrooms',
      completion_deadline: 'by March',
      timeline_fit: 'yes',
      decision_maker: 'yes',
      budget_mentioned: 'none',
      outcome: 'booked',
      decline_reason: null,
      booked_slot_start: '2026-09-07T05:30:00.000Z',
      callback_preference: null,
      notes_for_designer: 'Referred by Shruti Joshi (Aundh client).',
    });
    expect(isCompleteRecord(r.fields)).toBe(true);
  });

  it('turns placeholders into null (but keeps budget_mentioned "none", which is a real value)', () => {
    const r = mapEntities({ ...booked, locality: 'N/A', scope: '  ', completion_deadline: 'null', callback_preference: 'Not mentioned', notes_for_designer: '-' });
    expect(r.fields.locality).toBeNull();
    expect(r.fields.scope).toBeNull();
    expect(r.fields.completion_deadline).toBeNull();
    expect(r.fields.callback_preference).toBeNull();
    expect(r.fields.notes_for_designer).toBeNull();
    expect(r.fields.budget_mentioned).toBe('none');
  });

  it('normalises enum case, spaces and hyphens', () => {
    const r = mapEntities({ ...booked, enquiry_type: 'New Enquiry', property_type: 'Independent-House', decision_maker: 'AUTHORISED_REP' });
    expect(r.fields.enquiry_type).toBe('new_enquiry');
    expect(r.fields.property_type).toBe('independent_house');
    expect(r.fields.decision_maker).toBe('authorised_rep');
  });

  it('drops an invalid enum value and reports it', () => {
    const r = mapEntities({ ...booked, in_service_area: 'maybe' });
    expect(r.fields.in_service_area).toBeNull();
    expect(r.problems).toEqual(['in_service_area: unexpected value "maybe"']);
  });

  it('parses carpet area from words and numbers', () => {
    expect(mapEntities({ ...booked, carpet_area_sqft: 'about 1,400 sq ft' }).fields.carpet_area_sqft).toBe(1400);
    expect(mapEntities({ ...booked, carpet_area_sqft: 950 }).fields.carpet_area_sqft).toBe(950);
    expect(mapEntities({ ...booked, carpet_area_sqft: 'not sure' }).fields.carpet_area_sqft).toBeNull();
  });

  it('reads a booked slot without an offset as IST', () => {
    expect(mapEntities({ ...booked, booked_slot_iso: '2026-09-07T11:00:00' }).fields.booked_slot_start).toBe('2026-09-07T05:30:00.000Z');
    expect(mapEntities({ ...booked, booked_slot_iso: '2026-09-07 11:00' }).fields.booked_slot_start).toBe('2026-09-07T05:30:00.000Z');
  });

  it('reports an unparseable booked slot', () => {
    const r = mapEntities({ ...booked, booked_slot_iso: 'next Monday morning' });
    expect(r.fields.booked_slot_start).toBeNull();
    expect(r.problems).toContain('booked_slot_iso: not a date "next Monday morning"');
  });

  it('marks the call incomplete when an essential field (outcome or enquiry_type) is missing or invalid', () => {
    expect(mapEntities({ ...booked, outcome: null }).outcome).toBe('incomplete');
    expect(mapEntities({ ...booked, outcome: 'confirmed' }).outcome).toBe('incomplete');
    expect(mapEntities({ ...booked, enquiry_type: undefined }).outcome).toBe('incomplete');
    expect(mapEntities({}).outcome).toBe('incomplete');
    expect(mapEntities(null).outcome).toBe('incomplete');
    expect(mapEntities('Transcript is not available for further evaluations.').outcome).toBe('incomplete');
  });

  it('keeps Vaani’s own "incomplete" outcome', () => {
    expect(mapEntities({ ...booked, outcome: 'incomplete' }).outcome).toBe('incomplete');
  });

  it('normalises decline reasons to the listed codes, else "other"', () => {
    expect(mapEntities({ ...booked, outcome: 'declined', decline_reason: 'Budget' }).fields.decline_reason).toBe('budget');
    expect(mapEntities({ ...booked, outcome: 'declined', decline_reason: 'out of area' }).fields.decline_reason).toBe('out_of_area');
    expect(mapEntities({ ...booked, outcome: 'declined', decline_reason: 'wants a restaurant' }).fields.decline_reason).toBe('other');
  });

  it('accepts entity keys in any case', () => {
    expect(mapEntities({ Caller_Name: 'Ritu', OUTCOME: 'callback', Enquiry_Type: 'new_enquiry' }).fields.caller_name).toBe('Ritu');
  });
});

describe('isCompleteRecord', () => {
  it('requires name, locality, property, scope and deadline for a new enquiry', () => {
    const { fields } = mapEntities(booked);
    expect(isCompleteRecord({ ...fields, scope: null })).toBe(false);
    expect(isCompleteRecord({ ...fields, completion_deadline: null })).toBe(false);
  });

  it('requires only a name for existing clients and vendors', () => {
    const { fields } = mapEntities({ caller_name: 'Sheetal', enquiry_type: 'existing_client', outcome: 'existing_client_transferred' });
    expect(isCompleteRecord(fields)).toBe(true);
    expect(isCompleteRecord({ ...fields, caller_name: null })).toBe(false);
  });

  it('is never complete for an incomplete call', () => {
    const { fields } = mapEntities({ ...booked, outcome: 'incomplete' });
    expect(isCompleteRecord(fields)).toBe(false);
  });
});
