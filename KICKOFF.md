# Prompts to paste into Claude Code

## Session 1 — explore and plan (start with `claude --permission-mode plan`)

Read @CLAUDE.md, @SPEC.md and @VAANI_AGENT.md, and skim the files in /context.
We are building the Vaani MVP described in SPEC.md — nothing outside its scope.

First do checkpoint 0 only: read the external API docs listed in SPEC.md §5 and write NOTES.md answering every question in checkpoint 0, with the doc URL for each answer. Flag anything that contradicts the spec.

Then write PLAN.md: the files you will create for checkpoints 1–8, the interfaces of each adapter (Vaani, Cal.com, Gemini, Resend), the Supabase schema, and the tests that prove each checkpoint. End PLAN.md with a list of open questions for me. Don't write application code yet.

## Session 2 onward — build one checkpoint at a time (default or auto mode)

Implement checkpoint N from @PLAN.md and @SPEC.md. Write the tests first, then the code. Run `npm test` and fix failures until everything passes — address root causes, don't skip or weaken tests. Show me the test output as evidence, list any deviation from the spec, then commit with a descriptive message. Stop after this checkpoint.

## Final session — verify

Run `tests/e2e.test.ts` and show the output. Then use a subagent to review the full diff against SPEC.md §7–§18: report only gaps that break a stated requirement or the price rule, not style preferences. Fix the gaps, re-run the tests, commit. Finally, print the manual steps from SPEC.md §19 as a checklist for me.
