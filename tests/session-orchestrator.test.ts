import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionOrchestrator } from '../src/services/session-orchestrator.js';
import { createMockIntelligenceClient } from '../src/services/intelligence-client.js';
import { createSessionStore } from '../src/stores/session-store.js';
import { createWorkflowStore } from '../src/stores/workflow-store.js';
import { ChannelType, IntentType, WorkflowStatus } from '../src/types/index.js';
import type { ClassificationResult } from '../src/types/workflow.js';

describe('SessionOrchestrator', () => {
  const agentId = 'test_agent';
  let intelligenceClient: ReturnType<typeof createMockIntelligenceClient>;
  let sessionStore: ReturnType<typeof createSessionStore>;
  let workflowStore: ReturnType<typeof createWorkflowStore>;
  let orchestrator: ReturnType<typeof createSessionOrchestrator>;

  const createClassification = (
    overrides?: Partial<ClassificationResult>
  ): ClassificationResult => ({
    intent: IntentType.FOOD_ORDERING,
    requiredCategories: ['FOOD', 'HEALTH'],
    requiredScopes: ['preferences.food.read', 'health.read'],
    confidence: 0.8,
    ...overrides,
  });

  beforeEach(() => {
    intelligenceClient = createMockIntelligenceClient();
    sessionStore = createSessionStore();
    workflowStore = createWorkflowStore();
    orchestrator = createSessionOrchestrator(
      intelligenceClient,
      sessionStore,
      workflowStore,
      { agentId }
    );
  });

  describe('orchestrate', () => {
    it('should create session request when no sessions exist', async () => {
      const result = await orchestrator.orchestrate(
        'participant_001',
        ChannelType.TELEGRAM,
        'user_123',
        'Order some food',
        createClassification()
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('session_creation_required');
      expect(result.workflowId).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.signingInstructions).toContain('/resume');

      // Verify workflow was created
      const workflow = await workflowStore.get(result.workflowId);
      expect(workflow).not.toBeNull();
      expect(workflow?.status).toBe(WorkflowStatus.WAITING_FOR_SIGNATURE);
    });

    it('should find valid session when one exists', async () => {
      const participantId = 'participant_002';
      const validSessionId = 'sess_valid_123';

      // Add valid session to mock client
      intelligenceClient.addValidSession(participantId, validSessionId);

      // Add session to local store
      await sessionStore.addSessionId(participantId, validSessionId);

      const result = await orchestrator.orchestrate(
        participantId,
        ChannelType.TELEGRAM,
        'user_456',
        'Order pizza',
        createClassification()
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('session_found');
      expect(result.sessionId).toBe(validSessionId);

      // Verify workflow status
      const workflow = await workflowStore.get(result.workflowId);
      expect(workflow?.status).toBe(WorkflowStatus.SESSION_ACTIVE);
    });

    it('should try all sessions until finding a valid one', async () => {
      const participantId = 'participant_003';
      const invalidSession1 = 'sess_invalid_1';
      const invalidSession2 = 'sess_invalid_2';
      const validSession = 'sess_valid';

      // Only the last session is valid
      intelligenceClient.addValidSession(participantId, validSession);

      // Add all sessions to local store
      await sessionStore.addSessionId(participantId, invalidSession1);
      await sessionStore.addSessionId(participantId, invalidSession2);
      await sessionStore.addSessionId(participantId, validSession);

      const result = await orchestrator.orchestrate(
        participantId,
        ChannelType.TELEGRAM,
        'user_789',
        'Order food',
        createClassification()
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('session_found');
      expect(result.sessionId).toBe(validSession);
    });

    it('should create new session when all existing sessions are invalid', async () => {
      const participantId = 'participant_004';
      const invalidSession = 'sess_invalid';

      // Add invalid session to local store (not to mock client's valid list)
      await sessionStore.addSessionId(participantId, invalidSession);

      const result = await orchestrator.orchestrate(
        participantId,
        ChannelType.TELEGRAM,
        'user_abc',
        'Order food',
        createClassification()
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('session_creation_required');
      // Should create a new session ID, not use the invalid one
      expect(result.sessionId).not.toBe(invalidSession);
    });

    it('should store workflow with correct classification data', async () => {
      const classification = createClassification({
        intent: IntentType.FOOD_ORDERING,
        requiredCategories: ['FOOD'],
        requiredScopes: ['preferences.food.read'],
      });

      const result = await orchestrator.orchestrate(
        'participant_005',
        ChannelType.WHATSAPP,
        '+1234567890',
        'Get me a burger',
        classification
      );

      const workflow = await workflowStore.get(result.workflowId);
      expect(workflow).not.toBeNull();
      expect(workflow?.participantId).toBe('participant_005');
      expect(workflow?.channel).toBe(ChannelType.WHATSAPP);
      expect(workflow?.externalUserId).toBe('+1234567890');
      expect(workflow?.originalMessage).toBe('Get me a burger');
      expect(workflow?.intent).toBe(IntentType.FOOD_ORDERING);
      expect(workflow?.requiredCategories).toEqual(['FOOD']);
      expect(workflow?.requiredScopes).toEqual(['preferences.food.read']);
    });
  });

  describe('getWorkflowStore', () => {
    it('should return the workflow store', () => {
      expect(orchestrator.getWorkflowStore()).toBe(workflowStore);
    });
  });

  describe('getSessionStore', () => {
    it('should return the session store', () => {
      expect(orchestrator.getSessionStore()).toBe(sessionStore);
    });
  });
});
