import type { ClassificationResult } from '../types/workflow.js';
import { IntentType, PermissionCategory } from '../types/workflow.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('request-classifier');

const FOOD_ORDERING_SCOPES = ['preferences.food.read', 'health.read', 'profile.address.read', 'finance.payment.read'];
const FOOD_ORDERING_CATEGORIES = [PermissionCategory.FOOD, PermissionCategory.HEALTH, PermissionCategory.ADDRESS, PermissionCategory.PAYMENT];

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
];

const CLASSIFIER_SYSTEM_PROMPT =
  `You are an intent classifier for a food ordering assistant. ` +
  `Classify the user message as "food_ordering" if they want to order food, get food delivered, find a restaurant, or ask about food/dishes/nutrition. ` +
  `Otherwise classify as "unknown". ` +
  `Return ONLY valid JSON: {"intent":"food_ordering"} or {"intent":"unknown"}`;

export interface RequestClassifierConfig {
  /** Anthropic API key — enables LLM classification. Falls back to keyword matching if omitted. */
  apiKey?: string;
  /** Claude model to use (default: claude-haiku-4-5-20251001 — fast and cheap for classification) */
  model?: string;
}

export class RequestClassifier {
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(config: RequestClassifierConfig = {}) {
    this.apiKey = config.apiKey ?? undefined;
    this.model = config.model ?? 'claude-haiku-4-5-20251001';
  }

  async classify(message: string): Promise<ClassificationResult> {
    logger.debug('Classifying message', { messageLength: message.length, llm: !!this.apiKey });

    const isFoodOrder = this.apiKey
      ? await this.classifyWithLLM(message)
      : this.classifyWithKeywords(message);

    if (isFoodOrder) {
      logger.info('Classified as food_ordering intent', {
        categories: FOOD_ORDERING_CATEGORIES,
        scopes: FOOD_ORDERING_SCOPES,
      });
      return {
        intent: IntentType.FOOD_ORDERING,
        requiredCategories: [...FOOD_ORDERING_CATEGORIES],
        requiredScopes: [...FOOD_ORDERING_SCOPES],
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

  private async classifyWithLLM(message: string): Promise<boolean> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 32,
          system: CLASSIFIER_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: message }],
        }),
      });

      if (!res.ok) {
        logger.warn('LLM classifier API error — falling back to keywords', { status: res.status });
        return this.classifyWithKeywords(message);
      }

      const data = await res.json() as { content: Array<{ type: string; text: string }> };
      const text = data.content.find(c => c.type === 'text')?.text ?? '';
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned) as { intent: string };
      return parsed.intent === 'food_ordering';
    } catch (err) {
      logger.warn('LLM classifier failed — falling back to keywords', { error: (err as Error).message });
      return this.classifyWithKeywords(message);
    }
  }

  private classifyWithKeywords(message: string): boolean {
    const normalized = message.toLowerCase().trim();
    return FOOD_ORDERING_KEYWORDS.some(keyword => {
      if (keyword.includes(' ')) return normalized.includes(keyword);
      return new RegExp(`\\b${keyword}\\b`, 'i').test(normalized);
    });
  }
}

export function createRequestClassifier(config: RequestClassifierConfig = {}): RequestClassifier {
  return new RequestClassifier(config);
}
