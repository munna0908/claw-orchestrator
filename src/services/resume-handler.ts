import type { ResumePayload, ResumeParseResult } from '../types/workflow.js';
import type { ResumeResult } from '../types/session.js';
import type { IntelligenceClient } from './intelligence-client.js';
import type { SessionStore } from '../stores/session-store.js';
import type { WorkflowStore } from '../stores/workflow-store.js';
import { WorkflowStatus } from '../types/workflow.js';
import { WriteStatus } from '../types/intelligence.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('resume-handler');

/**
 * Resume command prefix
 */
export const RESUME_COMMAND = '/resume';

/**
 * Check if a message is a resume command
 */
export function isResumeCommand(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith(RESUME_COMMAND);
}

/**
 * Parse a resume command
 *
 * Expected format: /resume {"workflowId":"wf_123","sessionId":"sess_123","txHash":"0xtx123"}
 */
export function parseResumeCommand(text: string): ResumeParseResult {
  logger.debug('Parsing resume command', { textLength: text.length });

  if (!isResumeCommand(text)) {
    return {
      success: false,
      error: 'Not a resume command',
    };
  }

  // Extract JSON payload
  const trimmed = text.trim();
  const afterCommand = trimmed.slice(RESUME_COMMAND.length).trim();

  if (!afterCommand) {
    return {
      success: false,
      error: 'Missing resume payload. Expected format: /resume {"workflowId":"...","sessionId":"...","txHash":"..."}',
    };
  }

  // Find JSON object
  const jsonStart = afterCommand.indexOf('{');
  if (jsonStart === -1) {
    return {
      success: false,
      error: 'Invalid JSON format in resume payload',
    };
  }

  // Find matching closing brace
  let braceCount = 0;
  let jsonEnd = -1;

  for (let i = jsonStart; i < afterCommand.length; i++) {
    if (afterCommand[i] === '{') {
      braceCount++;
    } else if (afterCommand[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        jsonEnd = i;
        break;
      }
    }
  }

  if (jsonEnd === -1) {
    return {
      success: false,
      error: 'Invalid JSON format in resume payload',
    };
  }

  const jsonPayload = afterCommand.slice(jsonStart, jsonEnd + 1);

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch {
    return {
      success: false,
      error: 'Invalid JSON format in resume payload',
    };
  }

  // Validate it's an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      success: false,
      error: 'Resume payload must be a JSON object',
    };
  }

  const payloadObj = parsed as Record<string, unknown>;

  // Validate required fields
  const requiredFields = ['workflowId', 'sessionId', 'txHash'] as const;
  for (const field of requiredFields) {
    if (!(field in payloadObj)) {
      return {
        success: false,
        error: `Missing required field: ${field}`,
      };
    }

    if (typeof payloadObj[field] !== 'string' || (payloadObj[field] as string).trim() === '') {
      return {
        success: false,
        error: `Field '${field}' must be a non-empty string`,
      };
    }
  }

  const payload: ResumePayload = {
    workflowId: (payloadObj['workflowId'] as string).trim(),
    sessionId: (payloadObj['sessionId'] as string).trim(),
    txHash: (payloadObj['txHash'] as string).trim(),
  };

  logger.debug('Successfully parsed resume payload', {
    workflowId: payload.workflowId,
    sessionId: payload.sessionId,
  });

  return {
    success: true,
    payload,
  };
}

/**
 * Resume Handler
 *
 * Handles the /resume command to check transaction status
 * and activate sessions.
 */
export class ResumeHandler {
  private readonly intelligenceClient: IntelligenceClient;
  private readonly sessionStore: SessionStore;
  private readonly workflowStore: WorkflowStore;

  constructor(
    intelligenceClient: IntelligenceClient,
    sessionStore: SessionStore,
    workflowStore: WorkflowStore
  ) {
    this.intelligenceClient = intelligenceClient;
    this.sessionStore = sessionStore;
    this.workflowStore = workflowStore;

    logger.info('ResumeHandler initialized');
  }

  /**
   * Handle a resume command
   *
   * @param payload - Parsed resume payload
   * @param participantId - MOI participant ID (for validation)
   * @returns Resume result
   */
  async handleResume(payload: ResumePayload, participantId: string): Promise<ResumeResult> {
    const { workflowId, sessionId, txHash } = payload;

    logger.info('Handling resume command', {
      workflowId,
      sessionId,
      txHash,
      participantId,
    });

    // Step 1: Get workflow
    const workflow = await this.workflowStore.get(workflowId);

    if (!workflow) {
      logger.warn('Workflow not found for resume', { workflowId });
      return {
        success: false,
        action: 'workflow_not_found',
        workflowId,
        message: 'Workflow not found. Please start a new request.',
      };
    }

    // Validate participant owns this workflow
    if (workflow.participantId !== participantId) {
      logger.warn('Participant mismatch for resume', {
        workflowId,
        workflowParticipantId: workflow.participantId,
        requestParticipantId: participantId,
      });
      return {
        success: false,
        action: 'workflow_not_found',
        workflowId,
        message: 'Workflow not found. Please start a new request.',
      };
    }

    // Step 2: Check transaction status
    try {
      const statusResult = await this.intelligenceClient.getWriteStatus(txHash);

      logger.info('Write status retrieved', {
        workflowId,
        txHash,
        status: statusResult.status,
      });

      // Step 3: Handle based on status
      switch (statusResult.status) {
        case WriteStatus.CONFIRMED:
          return this.handleConfirmed(workflow.workflowId, participantId, sessionId, txHash);

        case WriteStatus.PENDING:
          return this.handlePending(workflow.workflowId, txHash);

        case WriteStatus.FAILED:
          return this.handleFailed(workflow.workflowId, txHash, statusResult.error);

        default:
          logger.warn('Unknown write status', { status: statusResult.status });
          return {
            success: false,
            action: 'error',
            workflowId,
            message: 'Unknown transaction status. Please try again later.',
          };
      }
    } catch (error) {
      logger.error('Failed to get write status', error as Error, {
        workflowId,
        txHash,
      });

      return {
        success: false,
        action: 'error',
        workflowId,
        message: 'Failed to check transaction status. Please try again later.',
      };
    }
  }

  /**
   * Handle confirmed transaction
   */
  private async handleConfirmed(
    workflowId: string,
    participantId: string,
    sessionId: string,
    txHash: string
  ): Promise<ResumeResult> {
    logger.info('Transaction confirmed, activating session', {
      workflowId,
      participantId,
      sessionId,
      txHash,
    });

    // Update workflow
    await this.workflowStore.update(workflowId, {
      status: WorkflowStatus.SESSION_ACTIVE,
      sessionId,
      txHash,
    });

    // Add session to local store
    await this.sessionStore.addSessionId(participantId, sessionId);

    // Update to READY_FOR_INFERENCE
    await this.workflowStore.update(workflowId, {
      status: WorkflowStatus.READY_FOR_INFERENCE,
    });

    return {
      success: true,
      action: 'session_active',
      workflowId,
      sessionId,
      message: 'Session is active. Continuing workflow.',
    };
  }

  /**
   * Handle pending transaction
   */
  private async handlePending(workflowId: string, txHash: string): Promise<ResumeResult> {
    logger.info('Transaction still pending', {
      workflowId,
      txHash,
    });

    // Update workflow status
    await this.workflowStore.update(workflowId, {
      status: WorkflowStatus.WAITING_FOR_CONFIRMATION,
      txHash,
    });

    return {
      success: true,
      action: 'pending',
      workflowId,
      message: 'Your session transaction is still pending. Please wait for confirmation.',
    };
  }

  /**
   * Handle failed transaction
   */
  private async handleFailed(
    workflowId: string,
    txHash: string,
    error?: string
  ): Promise<ResumeResult> {
    logger.info('Transaction failed', {
      workflowId,
      txHash,
      error,
    });

    // Update workflow status
    await this.workflowStore.update(workflowId, {
      status: WorkflowStatus.FAILED,
      txHash,
    });

    const message = error
      ? `Session approval failed: ${error}`
      : 'Session approval failed. Please try again.';

    return {
      success: false,
      action: 'failed',
      workflowId,
      message,
    };
  }
}

/**
 * Factory function to create a ResumeHandler
 */
export function createResumeHandler(
  intelligenceClient: IntelligenceClient,
  sessionStore: SessionStore,
  workflowStore: WorkflowStore
): ResumeHandler {
  return new ResumeHandler(intelligenceClient, sessionStore, workflowStore);
}
