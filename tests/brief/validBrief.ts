import type { Brief } from '@/lib/brief/schema';

/** A valid brief for the t01 lead, shared by brief, email and click tests. */
export const VALID_BRIEF: Brief = {
  headline: 'Priya · Kothrud · apartment · kitchen, living room, both bedrooms',
  what_they_want: 'A complete redesign of a 3BHK builder flat. They want the kitchen, living room and both bedrooms done by March.',
  criteria: [
    { criterion: 'real_project', status: 'met', evidence: 'We want to redo the whole thing.' },
    { criterion: 'service_area', status: 'met', evidence: 'We have a 3BHK in Kothrud.' },
    { criterion: 'timeline', status: 'met', evidence: "We'd like to be done by March." },
    { criterion: 'budget', status: 'unclear', evidence: 'Budget not mentioned.' },
    { criterion: 'decision_maker', status: 'met', evidence: 'He knows I am calling and is happy to go ahead.' },
  ],
  uncertainties: ['Budget not discussed — establish fit at the consultation.'],
  suggested_opening: 'What do you like least about the flat as it is today?',
  booking: 'Consultation booked: Mon 7 Sep, 11:00 am',
  caller_stated_budget: null,
};
