import { describe, it, expect, beforeEach } from 'vitest';
import {
  createResumeHandler,
  isResumeCommand,
  parseResumeCommand,
  RESUME_COMMAND,
} from '../src/services/resume-handler.js';
import { createMockIntelligenceClient } from '../src/services/intelligence-client.js';
import { createSessionStore } from '../src/stores/session-store.js';
import { createWorkflowStore } from '../src/stores/workflow-store.js';
import { ChannelType, IntentType, WorkflowStatus, WriteStatus } from '../src/types/index.js';

describe('resume-handler', () => {
  describe('RESUME_COMMAND', () => {
    it('should be /resume', () => {
      expect(RESUME_COMMAND).toBe('/resume');
    });
  });

  describe('isResumeCommand', () => {
    it('should return true for /resume commands', () => {
      expect(isResumeCommand('/resume {...}')).toBe(true);
      expect(isResumeCommand('/resume{"workflowId":"123"}')).toBe(true);
      expect(isResumeCommand('  /resume {...}  ')).toBe(true);
    });

    it('should return false for non-resume commands', () => {
      expect(isResumeCommand('hello')).toBe(false);
      expect(isResumeCommand('/register {...}')).toBe(false);
      expect(isResumeCommand('resume {...}')).toBe(false);
    });
  });

  describe('parseResumeCommand', () => {
    it('should parse valid resume payload', () => {
      const text = '/resume {"workflowId":"wf_123","sessionId":"sess_456","txHash":"0xtx789"}';
      const result = parseResumeCommand(text);

      expect(result.success).toBe(true);
      expect(result.payload).toEqual({
        workflowId: 'wf_123',
        sessionId: 'sess_456',
        txHash: '0xtx789',
      });
    });

    it('should handle missing space after command', () => {
      const text = '/resume{"workflowId":"wf_123","sessionId":"sess_456","txHash":"0xtx789"}';
      const result = parseResumeCommand(text);

      expect(result.success).toBe(true);
      expect(result.payload?.workflowId).toBe('wf_123');
    });

    it('should fail for non-resume command', () => {
      const result = parseResumeCommand('hello');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not a resume command');
    });

    it('should fail for missing payload', () => {
      const result = parseResumeCommand('/resume');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing resume payload');
    });

    it('should fail for invalid JSON', () => {
      const result = parseResumeCommand('/resume {invalid}');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should fail for missing workflowId', () => {
      const result = parseResumeCommand('/resume {"sessionId":"sess","txHash":"tx"}');
      expect(result.success).toBe(false);
      expect(result.error).toContain('workflowId');
    });

    it('should fail for missing sessionId', () => {
      const result = parseResumeCommand('/resume {"workflowId":"wf","txHash":"tx"}');
      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId');
    });

    it('should fail for missing txHash', () => {
      const result = parseResumeCommand('/resume {"workflowId":"wf","sessionId":"sess"}');
      expect(result.success).toBe(false);
      expect(result.error).toContain('txHash');
    });
  });

  describe('ResumeHandler', () => {
    let intelligenceClient: ReturnType<typeof createMockIntelligenceClient>;
    let sessionStore: ReturnType<typeof createSessionStore>;
    let workflowStore: ReturnType<typeof createWorkflowStore>;
    let resumeHandler: ReturnType<typeof createResumeHandler>;

    beforeEach(() => {
      intelligenceClient = createMockIntelligenceClient();
      sessionStore = createSessionStore();
      workflowStore = createWorkflowStore();
      resumeHandler = createResumeHandler(
        intelligenceClient,
        sessionStore,
        workflowStore
      );
    });

    describe('handleResume', () => {
      it('should return workflow_not_found for non-existent workflow', async () => {
        const result = await resumeHandler.handleResume(
          {
            workflowId: 'wf_nonexistent',
            sessionId: 'sess_123',
            txHash: '0xtx123',
          },
          'participant_001'
        );

        expect(result.success).toBe(false);
        expect(result.action).toBe('workflow_not_found');
      });

      it('should return workflow_not_found for wrong participant', async () => {
        // Create a workflow for participant_001
        const workflow = await workflowStore.create({
          participantId: 'participant_001',
          channel: ChannelType.TELEGRAM,
          externalUserId: 'user_123',
          originalMessage: 'test',
          intent: IntentType.FOOD_ORDERING,
          requiredCategories: ['FOOD'],
          requiredScopes: ['preferences.food.read'],
        });

        // Try to resume with different participant
        const result = await resumeHandler.handleResume(
          {
            workflowId: workflow.workflowId,
            sessionId: 'sess_123',
            txHash: '0xtx123',
          },
          'participant_002' // Different participant
        );

        expect(result.success).toBe(false);
        expect(result.action).toBe('workflow_not_found');
      });

      it('should activate session when transaction is confirmed', async () => {
        const participantId = 'participant_003';
        const sessionId = 'sess_confirmed';
        const txHash = '0xtx_confirmed';

        // Create workflow
        const workflow = await workflowStore.create({
          participantId,
          channel: ChannelType.TELEGRAM,
          externalUserId: 'user_456',
          originalMessage: 'test',
          intent: IntentType.FOOD_ORDERING,
          requiredCategories: ['FOOD'],
          requiredScopes: ['preferences.food.read'],
        });

        // Mock confirmed status
        intelligenceClient.setWriteStatus(txHash, {
          txHash,
          status: WriteStatus.CONFIRMED,
          blockNumber: 12345,
          updatedAt: Math.floor(Date.now() / 1000),
        });

        const result = await resumeHandler.handleResume(
          {
            workflowId: workflow.workflowId,
            sessionId,
            txHash,
          },
          participantId
        );

        expect(result.success).toBe(true);
        expect(result.action).toBe('session_active');
        expect(result.sessionId).toBe(sessionId);
        expect(result.message).toContain('active');

        // Verify workflow status updated
        const updatedWorkflow = await workflowStore.get(workflow.workflowId);
        expect(updatedWorkflow?.status).toBe(WorkflowStatus.READY_FOR_INFERENCE);

        // Verify session added to store
        const sessions = await sessionStore.getSessionIds(participantId);
        expect(sessions).toContain(sessionId);
      });

      it('should return pending when transaction is pending', async () => {
        const participantId = 'participant_004';
        const txHash = '0xtx_pending';

        // Create workflow
        const workflow = await workflowStore.create({
          participantId,
          channel: ChannelType.TELEGRAM,
          externalUserId: 'user_789',
          originalMessage: 'test',
          intent: IntentType.FOOD_ORDERING,
          requiredCategories: ['FOOD'],
          requiredScopes: ['preferences.food.read'],
        });

        // Mock pending status
        intelligenceClient.setWriteStatus(txHash, {
          txHash,
          status: WriteStatus.PENDING,
          updatedAt: Math.floor(Date.now() / 1000),
        });

        const result = await resumeHandler.handleResume(
          {
            workflowId: workflow.workflowId,
            sessionId: 'sess_pending',
            txHash,
          },
          participantId
        );

        expect(result.success).toBe(true);
        expect(result.action).toBe('pending');
        expect(result.message).toContain('pending');

        // Verify workflow status
        const updatedWorkflow = await workflowStore.get(workflow.workflowId);
        expect(updatedWorkflow?.status).toBe(WorkflowStatus.WAITING_FOR_CONFIRMATION);
      });

      it('should return failed when transaction failed', async () => {
        const participantId = 'participant_005';
        const txHash = '0xtx_failed';

        // Create workflow
        const workflow = await workflowStore.create({
          participantId,
          channel: ChannelType.TELEGRAM,
          externalUserId: 'user_abc',
          originalMessage: 'test',
          intent: IntentType.FOOD_ORDERING,
          requiredCategories: ['FOOD'],
          requiredScopes: ['preferences.food.read'],
        });

        // Mock failed status
        intelligenceClient.setWriteStatus(txHash, {
          txHash,
          status: WriteStatus.FAILED,
          error: 'Insufficient funds',
          updatedAt: Math.floor(Date.now() / 1000),
        });

        const result = await resumeHandler.handleResume(
          {
            workflowId: workflow.workflowId,
            sessionId: 'sess_failed',
            txHash,
          },
          participantId
        );

        expect(result.success).toBe(false);
        expect(result.action).toBe('failed');
        expect(result.message).toContain('failed');

        // Verify workflow status
        const updatedWorkflow = await workflowStore.get(workflow.workflowId);
        expect(updatedWorkflow?.status).toBe(WorkflowStatus.FAILED);
      });
    });
  });
});
