import { getAdapters } from '@/lib/adapters';
import { buildPatches } from './build';
import { parseAgentMd } from './parseAgentMd';

/**
 * Push VAANI_AGENT.md + lib/leadSchema.ts to the Vaani agent (SPEC §17.7), one PATCH per section.
 * PATCHes deep-merge, so dashboard-only settings (voice, telephony, tools, knowledge base) are kept.
 */
export async function configureVaani(opts: { md: string; agentId: string; dryRun: boolean; log: (s: string) => void }) {
  const patches = buildPatches(parseAgentMd(opts.md));
  if (opts.dryRun) {
    opts.log(JSON.stringify(patches, null, 2));
    return patches;
  }
  if (!opts.agentId) throw new Error('VAANI_AGENT_ID is not set');
  const vaani = getAdapters().vaani;
  await vaani.updatePersona(opts.agentId, patches.persona);
  opts.log('persona   ✓ system prompt, greeting, timezone');
  await vaani.updateTraining(opts.agentId, patches.training);
  opts.log(`training  ✓ ${Object.keys(patches.training.know_how.faq).length} FAQ, ${patches.training.know_how.guardrails.custom_rules.length} guardrail rules`);
  await vaani.updateExperience(opts.agentId, patches.experience);
  opts.log('experience ✓ 12-min limit, idle 10 s + 10 s, end-call');
  await vaani.updateAnalysis(opts.agentId, patches.analysis);
  opts.log(`analysis  ✓ ${patches.analysis.extraction.data_collection.data_points.length} data points, ${patches.analysis.evaluations.dispositions.prompt_based.length} disposition`);
  return patches;
}
