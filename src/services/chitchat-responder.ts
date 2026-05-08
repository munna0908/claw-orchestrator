import { createLogger } from '../logger/index.js';

const logger = createLogger('chitchat-responder');

const SYSTEM_PROMPT =
  `You are TrustClaw, a personal assistant purpose-built for food ordering. ` +
  `Keep all replies to 1-2 short sentences. Never use bullet points. Never mention MOI, blockchain, or any technical infrastructure. ` +
  `If the user is making casual conversation (greetings, small talk, how are you, etc.), reply warmly and naturally — do NOT mention food every time. ` +
  `If the user asks you to do something unrelated to food ordering (rephrase text, answer trivia, give advice, etc.), politely let them know you're TrustClaw — built specifically to help people order food personalised to their preferences, health profile, and schedule. That's your specialty, and that's where you shine.`;

const FALLBACK = `Hey there! 👋 Just say "order food" whenever you're ready and I'll take it from there.`;

export interface ChitchatResponderConfig {
  apiKey?: string;
  model?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}

export class ChitchatResponder {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly geminiApiKey: string | undefined;
  private readonly geminiModel: string;

  constructor(config: ChitchatResponderConfig = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'claude-haiku-4-5-20251001';
    this.geminiApiKey = config.geminiApiKey;
    this.geminiModel = config.geminiModel ?? 'gemini-2.0-flash';
  }

  async respond(message: string): Promise<string> {
    if (this.apiKey) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 80,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: message }],
          }),
        });
        if (res.ok) {
          const data = await res.json() as { content: Array<{ type: string; text: string }> };
          return data.content.find(c => c.type === 'text')?.text.trim() ?? FALLBACK;
        }
        logger.warn('Claude chitchat API error — trying Gemini fallback', { status: res.status });
      } catch (err) {
        logger.warn('Claude chitchat failed — trying Gemini fallback', { error: (err as Error).message });
      }
    }

    if (this.geminiApiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: 'user', parts: [{ text: message }] }],
              generationConfig: { maxOutputTokens: 80 },
            }),
          },
        );
        if (res.ok) {
          const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
          return data.candidates[0]?.content.parts[0]?.text.trim() ?? FALLBACK;
        }
        logger.warn('Gemini chitchat API error — using fallback', { status: res.status });
      } catch (err) {
        logger.warn('Gemini chitchat failed — using fallback', { error: (err as Error).message });
      }
    }

    return FALLBACK;
  }
}

export function createChitchatResponder(config: ChitchatResponderConfig = {}): ChitchatResponder {
  return new ChitchatResponder(config);
}
