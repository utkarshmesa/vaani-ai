import { LEAD_FIELDS } from '@/lib/leadSchema';
import type { AgentMd } from './parseAgentMd';

/**
 * Vaani agent configuration built from VAANI_AGENT.md + lib/leadSchema.ts (SPEC §17.7).
 * Section shapes follow the Update Persona / Training / Experience / Analysis API pages (NOTES.md §1.5)
 * and the dashboard's "Import from JSON" sample.
 */

/** Words the speech-to-text should expect: studio name, Pune/PCMC localities, project vocabulary. */
const STT_KEYWORDS = [
  'Aangan', 'Aangan Studio', 'Kothrud', 'Baner', 'Aundh', 'Wakad', 'Koregaon Park', 'Kalyani Nagar', 'Viman Nagar',
  'Hadapsar', 'Magarpatta', 'NIBM', 'Kondhwa', 'Undri', 'Shivane', 'Warje', 'Erandwane', 'Deccan', 'Kharadi',
  'Pimpri', 'Chinchwad', 'Pimple Saudagar', 'Pimple Nilakh', 'Ravet', 'Hinjewadi', 'PCMC', 'Talegaon', 'Lonavala',
  'BHK', 'carpet area', 'modular kitchen', 'wardrobes', 'Vastu',
];

const WRAP_UP = "We've reached the time limit for this call. Thank you for calling Aangan Studio — our team has your details and will follow up with you.";

export function buildPatches(a: AgentMd) {
  const persona = {
    identity: {
      system_prompt: a.systemPrompt,
      greeting_message: {
        agent_message: a.greeting,
        agent_speech_delay: 1,
        interruptible: true,
        let_user_speak_first: false,
        user_speech_delay: 0,
      },
    },
    timezone: 'Asia/Kolkata',
  };

  const training = {
    know_how: {
      faq: Object.fromEntries(a.faq.map((f) => [f.question, f.answer])),
      guardrails: {
        level: a.guardrailLevel,
        sexual: true,
        violence: true,
        threatning: true, // sic — Vaani's field name
        custom_rules: a.guardrailRules.map((rule) => ({ rule })),
      },
    },
  };

  // VAANI_AGENT.md "Experience settings": 12-minute max with a polite wrap-up; end-call on;
  // idle warning at 10 s, hang up after a further 10 s.
  const experience = {
    conversational_experience: {
      eagerness_to_speak: 'balanced',
    },
    settings: {
      idle_conversation_settings: {
        pulse_check: true,
        end_conversation_on_idle: true,
        idle_call_warning_timeout: 10,
        idle_call_hangup_timeout: 10,
        idle_call_warning_message: 'Hello, are you still there?',
        idle_call_hangup_message: "I can't hear you, so I'll end the call now. Please call Aangan Studio again any time.",
      },
      end_call: { enabled: true },
      call_settings: {
        max_call_duration: 12,
        max_duration_enabled: true,
        max_duration_action: 'hang_up',
        max_duration_hangup_message: WRAP_UP,
      },
    },
  };

  const analysis = {
    evaluations: {
      dispositions: {
        enabled: true,
        prompt_based: a.dispositions.map((d) => ({
          name: d.name,
          type: d.type,
          prompt: d.prompt,
          list_of_tags: {
            Yes: 'The agent itself stated a price, amount, range, rate or typical cost.',
            No: 'The agent did not state any price (the caller mentioning one does not count).',
          },
        })),
      },
    },
    extraction: {
      data_collection: {
        enabled: true,
        data_points: LEAD_FIELDS.map((f) => ({
          name: f.name,
          prompt: f.prompt,
          values: 'values' in f ? [...f.values] : [],
          nullable: f.nullable,
        })),
      },
    },
  };

  return { persona, training, experience, analysis };
}

/**
 * A complete agent for the dashboard's Design → Agents → New Agent → Import from JSON.
 * Providers: Google Gemini as the LLM (SPEC §19); Cartesia voice with an ElevenLabs fallback (Vaani rejects the
 * same provider twice, and this account disallows AWS TTS).
 * Speech settings are a starting point — adjust language and voice in the dashboard (manual step).
 */
export function buildAgentImport(a: AgentMd) {
  const p = buildPatches(a);
  return {
    agent_display_name: 'Aangan Studio enquiries',
    metadata: {},
    persona: {
      metadata: {},
      identity: {
        ...p.persona.identity,
        personality: { tone: 'warm', style: 'unhurried and respectful' },
      },
      senses_capabilities: {
        language: 'English',
        auto_detect: false,
        ears: {
          stt: {
            primary: { provider: 'deepgram', model: 'nova-3', language: 'en', keywords: STT_KEYWORDS, config: { language: 'en' } },
            fallback: {
              provider: 'assemblyai', model: 'best', language: 'English',
              config: { end_of_turn_confidence_threshold: 0.5, min_end_of_turn_silence_when_confident: 160, max_turn_silence: 1280, format_turns: true },
            },
          },
        },
        brain: {
          llm: {
            primary: { provider: 'google', model: 'gemini-3.5-flash', parameters: { temperature: 0.4, top_p: 1, max_tokens: 1000 } },
            fallback: { provider: 'openai', model: 'gpt-4o', parameters: { temperature: 0.4, top_p: 1, max_tokens: 1000 } },
            auto_detect: false,
          },
        },
        mouth: {
          tts: {
            primary: {
              provider: 'cartesia', model: 'sonic-3.5', voice_id: '1259b7e3-cb8a-43df-9446-30971a46b8b0', voice_name: 'devansh',
              is_cloned: false, language: 'en', config: { speed: 0.95, language: 'en', emotion: ['positivity:high'], emotions: [] },
            },
            // Vaani requires a different provider for the fallback voice; AWS is disallowed on this account.
            fallback: {
              provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice_id: '9T9vSqRrPPxIs5wpyZfK',
              is_cloned: false, config: { language: 'en' },
            },
            word_pronunciation_pairs: { Aangan: 'Aan-gun' },
          },
        },
      },
      actions: { agent_name: '', functions: [], count: 0 },
      memories: { agent_name: '', use_previous_call_contexts: false, max_history_calls: 0, feed_context_api: {}, use_rag: false, knowledge_bases: [], total_count: 0 },
      timezone: p.persona.timezone,
      agent_gender: 'male',
    },
    training: {
      knowledge: { use_rag: false, rag_knowledge_base_dict: { knowledge_bases: {} }, filler_messages: [], interruptible: true },
      know_how: {
        faq: p.training.know_how.faq,
        pain_points: {},
        guardrails: p.training.know_how.guardrails,
      },
    },
    experience: p.experience,
    analysis: p.analysis,
    deployment_config: { ideal_deployment: 'Inbound' },
    frontend_features: {
      recording: true, transcript: true, summary: true, conversation_evaluation: false,
      extracted_information: true, preemptive_generation: false, volume_control: true,
    },
  };
}
