import { describe, it, expect } from 'vitest';
import { createRequestClassifier } from '../src/services/request-classifier.js';
import { IntentType } from '../src/types/workflow.js';

describe('RequestClassifier', () => {
  const classifier = createRequestClassifier();

  describe('classify', () => {
    describe('food ordering intent', () => {
      it('should classify "order some food for dinner" as food_ordering', async () => {
        const result = await classifier.classify('Order some food for dinner');

        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
        expect(result.requiredCategories).toContain('FOOD');
        expect(result.requiredCategories).toContain('HEALTH');
        expect(result.requiredScopes).toContain('preferences.food.read');
        expect(result.requiredScopes).toContain('health.read');
        expect(result.confidence).toBeGreaterThan(0.5);
      });

      it('should classify "I want pizza" as food_ordering', async () => {
        const result = await classifier.classify('I want pizza');
        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
      });

      it('should classify "hungry, get me a burger" as food_ordering', async () => {
        const result = await classifier.classify('hungry, get me a burger');
        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
      });

      it('should classify "order lunch delivery" as food_ordering', async () => {
        const result = await classifier.classify('order lunch delivery');
        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
      });

      it('should classify "find a restaurant" as food_ordering', async () => {
        const result = await classifier.classify('find a restaurant');
        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
      });
    });

    describe('unknown intent', () => {
      it('should classify "hello" as unknown', async () => {
        const result = await classifier.classify('hello');

        expect(result.intent).toBe(IntentType.UNKNOWN);
        expect(result.requiredCategories).toEqual([]);
        expect(result.requiredScopes).toEqual([]);
        expect(result.confidence).toBe(0);
      });

      it('should classify "what is the weather" as unknown', async () => {
        const result = await classifier.classify('what is the weather');
        expect(result.intent).toBe(IntentType.UNKNOWN);
      });

      it('should classify empty string as unknown', async () => {
        const result = await classifier.classify('');
        expect(result.intent).toBe(IntentType.UNKNOWN);
      });
    });

    describe('case insensitivity', () => {
      it('should handle uppercase input', async () => {
        const result = await classifier.classify('ORDER FOOD');
        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
      });

      it('should handle mixed case input', async () => {
        const result = await classifier.classify('OrDeR fOoD');
        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
      });
    });

    describe('whitespace handling', () => {
      it('should handle leading/trailing whitespace', async () => {
        const result = await classifier.classify('  order food  ');
        expect(result.intent).toBe(IntentType.FOOD_ORDERING);
      });
    });
  });
});
