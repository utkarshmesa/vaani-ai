/** Parsed VAANI_AGENT.md — the human-editable source of the Vaani agent's configuration. */
export interface AgentMd {
  greeting: string;
  systemPrompt: string;
  faq: { question: string; answer: string }[];
  guardrailLevel: string;
  guardrailRules: string[];
  dispositions: { name: string; type: 'bool' | 'string' | 'number'; prompt: string }[];
}

/** Body of the "## <heading…>" section (up to the next "## "). */
function section(md: string, heading: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const head = new RegExp(`^## ${heading}(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) throw new Error(`VAANI_AGENT.md: section "## ${heading}" not found`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

function tableRows(body: string): string[][] {
  return body
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l))
    .slice(1) // header
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

export function parseAgentMd(md: string): AgentMd {
  const faq = tableRows(section(md, 'FAQ')).map(([question, answer]) => ({ question, answer }));

  const guard = section(md, 'Guardrails');
  const level = guard.match(/`level:\s*(\w+)`/)?.[1];
  if (!level) throw new Error('VAANI_AGENT.md: guardrail level not found');
  const rules = guard.split('\n').map((l) => l.match(/^\d+\.\s+(.*)$/)?.[1]).filter((r): r is string => Boolean(r));

  const dispositions = section(md, 'Dispositions')
    .split('\n')
    .map((l) => l.match(/^`(\w+)`\s*\((bool|string|number)\):\s*"(.+?)"/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ name: m[1], type: m[2] as 'bool' | 'string' | 'number', prompt: m[3] }));

  return {
    greeting: section(md, 'Greeting'),
    systemPrompt: section(md, 'System prompt'),
    faq,
    guardrailLevel: level,
    guardrailRules: rules,
    dispositions,
  };
}
