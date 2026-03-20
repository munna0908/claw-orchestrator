import type { ClassificationResult } from '../types/workflow.js';
import { IntentType, PermissionCategory } from '../types/workflow.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('request-classifier');

/**
 * Keywords that indicate food ordering intent
 */
const FOOD_ORDERING_KEYWORDS = [
  'order',
  'food',
  'eat',
  'dinner',
  'lunch',
  'breakfast',
  'hungry',
  'pizza',
  'burger',
  'restaurant',
  'delivery',
  'meal',
  'dish',
  'cuisine',
  'takeout',
  'takeaway',
  'snack',
  'drink',
  'beverage',
];

/**
 * Scopes required for food ordering
 */
const FOOD_ORDERING_SCOPES = ['preferences.food.read', 'health.read'];

/**
 * Categories required for food ordering
 */
const FOOD_ORDERING_CATEGORIES = [PermissionCategory.FOOD, PermissionCategory.HEALTH];

/**
 * Request Classifier
 *
 * Deterministic classifier for v1.
 * Uses keyword matching to identify intent.
 *
 * Future versions may use LLM-based classification.
 */
export class RequestClassifier {
  /**
   * Classify a user message
   *
   * @param message - The user's message text
   * @returns Classification result with intent, categories, and scopes
   */
  classify(message: string): ClassificationResult {
    logger.debug('Classifying message', { messageLength: message.length });

    const normalizedMessage = message.toLowerCase().trim();

    // Check for food ordering intent
    if (this.isFoodOrderingIntent(normalizedMessage)) {
      logger.info('Classified as food_ordering intent', {
        categories: FOOD_ORDERING_CATEGORIES,
        scopes: FOOD_ORDERING_SCOPES,
      });

      return {
        intent: IntentType.FOOD_ORDERING,
        requiredCategories: [...FOOD_ORDERING_CATEGORIES],
        requiredScopes: [...FOOD_ORDERING_SCOPES],
        confidence: this.calculateConfidence(normalizedMessage, FOOD_ORDERING_KEYWORDS),
      };
    }

    // Default to unknown intent
    logger.debug('Could not classify intent, returning unknown');
    return {
      intent: IntentType.UNKNOWN,
      requiredCategories: [],
      requiredScopes: [],
      confidence: 0,
    };
  }

  /**
   * Check if message indicates food ordering intent
   * Uses word boundary matching to avoid false positives
   */
  private isFoodOrderingIntent(message: string): boolean {
    const matchedKeywords = this.findMatchedKeywords(message, FOOD_ORDERING_KEYWORDS);
    return matchedKeywords.length > 0;
  }

  /**
   * Find keywords that match as whole words in the message
   */
  private findMatchedKeywords(message: string, keywords: string[]): string[] {
    return keywords.filter((keyword) => {
      // Use word boundary regex for accurate matching
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(message);
    });
  }

  /**
   * Calculate confidence based on keyword matches
   */
  private calculateConfidence(message: string, keywords: string[]): number {
    const matchedKeywords = this.findMatchedKeywords(message, keywords);
    const matchRatio = matchedKeywords.length / keywords.length;

    // Scale to 0.5-1.0 range for matched intents
    return 0.5 + matchRatio * 0.5;
  }
}

/**
 * Factory function to create a RequestClassifier
 */
export function createRequestClassifier(): RequestClassifier {
  return new RequestClassifier();
}
