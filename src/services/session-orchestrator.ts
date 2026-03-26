import type { ChannelType } from '../types/channel.js';
import type { ClassificationResult } from '../types/workflow.js';
import type { SessionSelectionResult, SessionOrchestrationResult } from '../types/session.js';
import type { IntelligenceClient } from './intelligence-client.js';
import type { SessionStore } from '../stores/session-store.js';
import type { WorkflowStore } from '../stores/workflow-store.js';
import { WorkflowStatus } from '../types/workflow.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('session-orchestrator');

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `sess_${timestamp}_${random}`;
}

/**
 * Session Orchestrator Configuration
 */
export interface SessionOrchestratorConfig {
  /** Agent ID for this plugin instance */
  agentId: string;

  /** Default requested uses for new sessions */
  defaultRequestedUses?: number;

  /** Default TTL in seconds for new sessions */
  defaultTtlSeconds?: number;

  /** Default key ID for signing */
  defaultKeyId?: number;
}

/**
 * Session Orchestrator
 *
 * Coordinates session validation and creation with the Intelligence Service.
 *
 * Flow:
 * 1. Get candidate session IDs from local store
 * 2. Validate each candidate with Intelligence Service
 * 3. If valid session found, use it
 * 4. If no valid session, prepare session creation request
 */
export class SessionOrchestrator {
  private readonly intelligenceClient: IntelligenceClient;
  private readonly sessionStore: SessionStore;
  private readonly workflowStore: WorkflowStore;
  private readonly config: Required<SessionOrchestratorConfig>;

  constructor(
    intelligenceClient: IntelligenceClient,
    sessionStore: SessionStore,
    workflowStore: WorkflowStore,
    config: SessionOrchestratorConfig
  ) {
    this.intelligenceClient = intelligenceClient;
    this.sessionStore = sessionStore;
    this.workflowStore = workflowStore;
    this.config = {
      agentId: config.agentId,
      defaultRequestedUses: config.defaultRequestedUses ?? 5,
      defaultTtlSeconds: config.defaultTtlSeconds ?? 1800,
      defaultKeyId: config.defaultKeyId ?? 0,
    };

    logger.info('SessionOrchestrator initialized', {
      agentId: this.config.agentId,
      defaultRequestedUses: this.config.defaultRequestedUses,
      defaultTtlSeconds: this.config.defaultTtlSeconds,
    });
  }

  /**
   * Orchestrate session for a classified request
   *
   * @param participantId - MOI participant ID
   * @param channel - Source channel
   * @param externalUserId - External user ID from channel
   * @param originalMessage - Original user message
   * @param classification - Classification result with intent and required permissions
   * @returns Orchestration result
   */
  async orchestrate(
    participantId: string,
    channel: ChannelType,
    externalUserId: string,
    originalMessage: string,
    classification: ClassificationResult
  ): Promise<SessionOrchestrationResult> {
    logger.info('Starting session orchestration', {
      participantId,
      channel,
      intent: classification.intent,
      requiredCategories: classification.requiredCategories,
      requiredScopes: classification.requiredScopes,
    });

    // Step 1: Create workflow record
    const workflow = await this.workflowStore.create({
      participantId,
      channel,
      externalUserId,
      originalMessage,
      intent: classification.intent,
      requiredCategories: classification.requiredCategories,
      requiredScopes: classification.requiredScopes,
    });

    logger.info('Created workflow', {
      workflowId: workflow.workflowId,
      requestId: workflow.requestId,
    });

    // Step 2: Update status to CHECKING_SESSIONS
    await this.workflowStore.update(workflow.workflowId, {
      status: WorkflowStatus.CHECKING_SESSIONS,
    });

    // Step 3: Get candidate session IDs from local store
    const candidateSessionIds = await this.sessionStore.getSessionIds(participantId);

    logger.info('Retrieved candidate sessions', {
      workflowId: workflow.workflowId,
      participantId,
      candidateCount: candidateSessionIds.length,
      candidateSessionIds,
    });

    // Step 4: If no candidates, go directly to session creation
    if (candidateSessionIds.length === 0) {
      logger.info('No candidate sessions found, proceeding to session creation', {
        workflowId: workflow.workflowId,
      });

      return this.createSessionRequest(
        workflow.workflowId,
        workflow.requestId,
        participantId,
        classification
      );
    }

    // Step 5: Validate candidate sessions
    const selectionResult = await this.validateCandidateSessions(
      participantId,
      candidateSessionIds,
      classification.requiredCategories,
      classification.requiredScopes
    );

    logger.info('Session validation complete', {
      workflowId: workflow.workflowId,
      found: selectionResult.found,
      checkedCount: selectionResult.checkedSessionIds.length,
      selectedSessionId: selectionResult.sessionId,
    });

    // Step 6: If valid session found, use it
    if (selectionResult.found && selectionResult.sessionId) {
      await this.workflowStore.update(workflow.workflowId, {
        status: WorkflowStatus.SESSION_ACTIVE,
        sessionId: selectionResult.sessionId,
      });

      logger.info('Session selected successfully', {
        workflowId: workflow.workflowId,
        sessionId: selectionResult.sessionId,
      });

      return {
        success: true,
        action: 'session_found',
        workflowId: workflow.workflowId,
        sessionId: selectionResult.sessionId,
      };
    }

    // Step 7: No valid session, proceed to session creation
    logger.info('No valid session found, proceeding to session creation', {
      workflowId: workflow.workflowId,
      invalidReasons: selectionResult.invalidReasons,
    });

    return this.createSessionRequest(
      workflow.workflowId,
      workflow.requestId,
      participantId,
      classification
    );
  }

  /**
   * Validate candidate sessions against required permissions
   */
  private async validateCandidateSessions(
    participantId: string,
    candidateSessionIds: string[],
    requiredCategories: string[],
    requiredScopes: string[]
  ): Promise<SessionSelectionResult> {
    const checkedSessionIds: string[] = [];
    const invalidReasons: Record<string, string> = {};
    const currentTime = Math.floor(Date.now() / 1000);

    for (const sessionId of candidateSessionIds) {
      checkedSessionIds.push(sessionId);

      try {
        logger.debug('Validating session', {
          participantId,
          sessionId,
          requiredCategories,
          requiredScopes,
        });

        const result = await this.intelligenceClient.validateSession(
          participantId,
          this.config.agentId,
          sessionId,
          requiredCategories,
          requiredScopes,
          currentTime
        );

        if (result.valid) {
          // Found a valid session - stop searching
          return {
            found: true,
            sessionId,
            checkedSessionIds,
            invalidReasons,
          };
        }

        // Record why this session was invalid
        invalidReasons[sessionId] = result.reason ?? 'unknown';
      } catch (error) {
        // Log error but continue checking other candidates
        logger.warn('Failed to validate session, continuing to next', {
          participantId,
          sessionId,
          error: (error as Error).message,
        });
        invalidReasons[sessionId] = `validation_error: ${(error as Error).message}`;
      }
    }

    // No valid session found
    return {
      found: false,
      checkedSessionIds,
      invalidReasons,
    };
  }

  /**
   * Create a session request via the Intelligence Service
   */
  private async createSessionRequest(
    workflowId: string,
    requestId: string,
    participantId: string,
    classification: ClassificationResult
  ): Promise<SessionOrchestrationResult> {
    // Generate new session ID
    const newSessionId = generateSessionId();

    // Update workflow status
    await this.workflowStore.update(workflowId, {
      status: WorkflowStatus.SESSION_REQUIRED,
      sessionId: newSessionId,
    });

    logger.info('Preparing session creation request', {
      workflowId,
      requestId,
      participantId,
      newSessionId,
    });

    try {
      // Call Intelligence Service to prepare the write
      const prepareResult = await this.intelligenceClient.prepareWrite({
        requestId,
        participantId,
        action: 'create_session_request',
        params: {
          sessionId: newSessionId,
          agentId: this.config.agentId,
          purpose: classification.intent,
          requiredCategories: classification.requiredCategories,
          requiredScopes: classification.requiredScopes,
          requestedUses: this.config.defaultRequestedUses,
          ttlSeconds: this.config.defaultTtlSeconds,
        },
      });

      // Update workflow with signing payload
      await this.workflowStore.update(workflowId, {
        status: WorkflowStatus.WAITING_FOR_SIGNATURE,
        signingPayload: {
          summary: prepareResult.summary,
        },
      });

      logger.info('Session creation prepared, waiting for signature', {
        workflowId,
        newSessionId,
        summary: prepareResult.summary,
      });

      // Generate signing instructions for user
      const signingInstructions = this.generateSigningInstructions(
        workflowId,
        newSessionId,
        prepareResult.summary
      );

      return {
        success: true,
        action: 'session_creation_required',
        workflowId,
        sessionId: newSessionId,
        signingInstructions,
        ixObject: prepareResult.ixObject,
        requestId: prepareResult.requestId,
      };
    } catch (error) {
      logger.error('Error preparing session creation', error as Error, {
        workflowId,
      });

      await this.workflowStore.update(workflowId, {
        status: WorkflowStatus.FAILED,
      });

      return {
        success: false,
        action: 'error',
        workflowId,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Generate signing instructions for the user
   */
  private generateSigningInstructions(
    workflowId: string,
    sessionId: string,
    summary?: string
  ): string {
    // For v1, return a placeholder message
    // Future versions will include wallet deep links
    const lines = [
      'Please sign the session request in your wallet to continue.',
      '',
      `Session: ${sessionId}`,
    ];

    if (summary) {
      lines.push(`Purpose: ${summary}`);
    }

    lines.push('');
    lines.push('After signing, send:');
    lines.push(`/resume {"workflowId":"${workflowId}","sessionId":"${sessionId}","txHash":"<your_tx_hash>"}`);

    return lines.join('\n');
  }

  /**
   * Get the workflow store (for external access)
   */
  getWorkflowStore(): WorkflowStore {
    return this.workflowStore;
  }

  /**
   * Get the session store (for external access)
   */
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }
}

/**
 * Factory function to create a SessionOrchestrator
 */
export function createSessionOrchestrator(
  intelligenceClient: IntelligenceClient,
  sessionStore: SessionStore,
  workflowStore: WorkflowStore,
  config: SessionOrchestratorConfig
): SessionOrchestrator {
  return new SessionOrchestrator(intelligenceClient, sessionStore, workflowStore, config);
}
