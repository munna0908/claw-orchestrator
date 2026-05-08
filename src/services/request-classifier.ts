import type { ClassificationResult } from '../types/workflow.js';
import { IntentType, PermissionCategory } from '../types/workflow.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('request-classifier');

const FOOD_ORDERING_SCOPES = ['preferences.food.read', 'health.read', 'profile.address.read', 'schedule.read'];
const FOOD_ORDERING_CATEGORIES = [PermissionCategory.FOOD, PermissionCategory.HEALTH, PermissionCategory.ADDRESS, PermissionCategory.SCHEDULE];

// Keyword fallback — used when no LLM API key is configured.
const FOOD_ORDERING_KEYWORDS = [
  'order', 'get me', 'bring me', 'send me', 'deliver', 'want to eat', 'want some',
  'craving', 'starving', 'hungry', 'grab some', 'have some',
  'food', 'eat', 'meal', 'dish', 'dinner', 'lunch', 'breakfast', 'snack', 'brunch',
  'restaurant', 'delivery', 'takeout', 'takeaway', 'cuisine',
  'drink', 'beverage', 'juice', 'coffee', 'tea',
  'pizza', 'burger', 'biryani', 'biriyani', 'noodles', 'pasta', 'sushi', 'sandwich',
  'wrap', 'salad', 'soup', 'curry', 'rice', 'roti', 'dosa', 'idli', 'tacos',
  'steak', 'chicken', 'mutton', 'prawn', 'seafood', 'paneer', 'tofu',
  'calories', 'protein', 'carbs', 'keto', 'vegan', 'vegetarian',
  // standalone affirmations — user is confirming they want to proceed with ordering
  'yes', 'yeah', 'yep', 'yup', 'ye',
];

const CHITCHAT_KEYWORDS = [
  'hi', 'hello', 'hey', 'howdy', 'hiya', 'sup', "what's up", 'yo',
  'thanks', 'thank you', 'cheers', 'appreciate', 'thx', 'ty',
  'bye', 'goodbye', 'see you', 'later', 'cya',
  'how are you', 'how r u', "how's it going", 'good morning', 'good evening', 'good night',
  'what can you do', 'who are you', 'what are you', 'help',
  'awesome', 'great', 'nice', 'cool',
  'lol', 'haha', 'hehe', '😄', '😊', '👍',
];

const CLASSIFIER_SYSTEM_PROMPT =
  `You are an intent classifier for a food-ordering assistant. ` +
  `Classify the user message into one of these intents:\n` +
  `- "food_ordering": wants to order food, get food delivered, find a restaurant, or asks about food/dishes/nutrition. ` +
  `Also classify standalone affirmations ("yes", "yeah", "yep", "ok", "sure", "alright") as food_ordering — the user is confirming they want to proceed.\n` +
  `- "chitchat": casual conversation — greetings, thanks, questions about the bot, small talk (but NOT bare affirmations)\n` +
  `- "unknown": anything off-topic — technical questions, blockchain, MOI network, business inquiries, sales offers, unrelated requests, etc.\n` +
  `Return ONLY valid JSON: {"intent":"food_ordering"}, {"intent":"chitchat"}, or {"intent":"unknown"}`;

export interface RequestClassifierConfig {
  /** Anthropic API key — enables Claude-based LLM classification. */
  apiKey?: string;
  /** Claude model to use (default: claude-haiku-4-5-20251001) */
  model?: string;
  /** Gemini API key — used if no Anthropic key is provided. */
  geminiApiKey?: string;
  /** Gemini model to use (default: gemini-2.0-flash) */
  geminiModel?: string;
}

export class RequestClassifier {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly geminiApiKey: string | undefined;
  private readonly geminiModel: string;

  constructor(config: RequestClassifierConfig = {}) {
    this.apiKey = config.apiKey ?? undefined;
    this.model = config.model ?? 'claude-haiku-4-5-20251001';
    this.geminiApiKey = config.geminiApiKey ?? undefined;
    this.geminiModel = config.geminiModel ?? 'gemini-2.0-flash';
  }

  async classify(message: string): Promise<ClassificationResult> {
    const hasLLM = !!(this.apiKey || this.geminiApiKey);
    logger.debug('Classifying message', { messageLength: message.length, llm: hasLLM });

    const intent = hasLLM
      ? await this.classifyWithLLM(message)
      : this.classifyWithKeywords(message);

    if (intent === 'food_ordering') {
      logger.info('Classified as food_ordering intent');
      return {
        intent: IntentType.FOOD_ORDERING,
        requiredCategories: [...FOOD_ORDERING_CATEGORIES],
        requiredScopes: [...FOOD_ORDERING_SCOPES],
        confidence: 1,
      };
    }

    if (intent === 'chitchat') {
      logger.debug('Classified as chitchat intent');
      return {
        intent: IntentType.CHITCHAT,
        requiredCategories: [],
        requiredScopes: [],
        confidence: 1,
      };
    }

    logger.debug('Classified as unknown intent');
    return {
      intent: IntentType.UNKNOWN,
      requiredCategories: [],
      requiredScopes: [],
      confidence: 0,
    };
  }

  private async classifyWithLLM(message: string): Promise<string> {
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
            max_tokens: 32,
            system: CLASSIFIER_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: message }],
          }),
        });

        if (res.ok) {
          const data = await res.json() as { content: Array<{ type: string; text: string }> };
          const text = data.content.find(c => c.type === 'text')?.text ?? '';
          const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(cleaned) as { intent: string };
          return parsed.intent;
        }
        logger.warn('Claude classifier API error — trying Gemini fallback', { status: res.status });
      } catch (err) {
        logger.warn('Claude classifier failed — trying Gemini fallback', { error: (err as Error).message });
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
              systemInstruction: { parts: [{ text: CLASSIFIER_SYSTEM_PROMPT }] },
              contents: [{ role: 'user', parts: [{ text: message }] }],
              generationConfig: { maxOutputTokens: 32 },
            }),
          },
        );

        if (res.ok) {
          const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
          const text = data.candidates[0]?.content.parts[0]?.text ?? '';
          const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(cleaned) as { intent: string };
          return parsed.intent;
        }
        logger.warn('Gemini classifier API error — falling back to keywords', { status: res.status });
      } catch (err) {
        logger.warn('Gemini classifier failed — falling back to keywords', { error: (err as Error).message });
      }
    }

    return this.classifyWithKeywords(message);
  }

  private classifyWithKeywords(message: string): string {
    const normalized = message.toLowerCase().trim();
    const matchKeyword = (kw: string) =>
      kw.includes(' ') ? normalized.includes(kw) : new RegExp(`\\b${kw}\\b`, 'i').test(normalized);

    if (FOOD_ORDERING_KEYWORDS.some(matchKeyword)) return 'food_ordering';
    if (CHITCHAT_KEYWORDS.some(matchKeyword)) return 'chitchat';
    return 'unknown';
  }
}

export function createRequestClassifier(config: RequestClassifierConfig = {}): RequestClassifier {
  return new RequestClassifier(config);
}
