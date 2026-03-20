import type { InboundMessage, MessageProcessingResult } from '../types/index.js';
import type { RegistrationChecker } from '../services/registration-checker.js';
import type { ReplyService } from '../services/reply-service.js';
import type { RegistrationService } from '../services/registration-service.js';
import type { RequestClassifier } from '../services/request-classifier.js';
import type { SessionOrchestrator } from '../services/session-orchestrator.js';
import type { ResumeHandler } from '../services/resume-handler.js';
import { isResumeCommand, parseResumeCommand } from '../services/resume-handler.js';
import { IntentType } from '../types/workflow.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('workflow-handler');

/**
 * Extended message processing result for all workflow actions
 */
export type ExtendedMessageAction =
  | 'registration_required'
  | 'workflow_continue'
  | 'registered'
  | 'already_registered'
  | 'registration_failed'
  | 'session_found'
  | 'session_creation_required'
  | 'session_resumed'
  | 'session_pending'
  | 'session_failed'
  | 'unknown_intent'
  | 'error';

export interface ExtendedMessageProcessingResult extends Omit<MessageProcessingResult, 'action'> {
  action: ExtendedMessageAction;
  moiAccountId?: string | undefined;
  workflowId?: string | undefined;
  sessionId?: string | undefined;
}

/**
 * WorkflowHandler
 *
 * Main handler for the participant workflow.
 * This is where messages are processed after routing.
 *
 * Flow:
 * 1. Check if message is a /register command → process registration
 * 2. Check if message is a /resume command → process resume
 * 3. Check if participant is registered → if not, send registration instructions
 * 4. Classify the request → determine intent, categories, scopes
 * 5. Orchestrate session → validate or create session
 * 6. Continue to inference (placeholder for later phases)
 */
export class WorkflowHandler {
  constructor(
    private readonly registrationChecker: RegistrationChecker,
    private readonly replyService: ReplyService,
    private readonly registrationService?: RegistrationService,
    private readonly requestClassifier?: RequestClassifier,
    private readonly sessionOrchestrator?: SessionOrchestrator,
    private readonly resumeHandler?: ResumeHandler
  ) {}

  /**
   * Handle an inbound message
   */
  async handle(message: InboundMessage): Promise<ExtendedMessageProcessingResult> {
    logger.debug('Handling message', {
      messageId: message.messageId,
      channel: message.channel,
      externalUserId: message.externalUserId,
      textPreview: message.text.substring(0, 50),
    });

    // Step 1: Check if this is a registration command
    if (this.registrationService?.isRegistrationCommand(message.text)) {
      return this.handleRegistrationCommand(message);
    }

    // Step 2: Check if this is a resume command
    if (isResumeCommand(message.text)) {
      return this.handleResumeCommand(message);
    }

    // Step 3: Check registration status for normal messages
    const registrationResult = await this.registrationChecker.check({
      channel: message.channel,
      externalUserId: message.externalUserId,
    });

    if (!registrationResult.isRegistered) {
      // Not registered - send registration required message
      logger.info('Unregistered user, sending registration prompt', {
        messageId: message.messageId,
        channel: message.channel,
        externalUserId: message.externalUserId,
      });

      await this.replyService.sendRegistrationRequired(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );

      return {
        success: true,
        messageId: message.messageId,
        action: 'registration_required',
      };
    }

    // Step 4: Registered user - continue to workflow with session orchestration
    logger.info('Registered user detected, starting workflow', {
      messageId: message.messageId,
      channel: message.channel,
      externalUserId: message.externalUserId,
      moiAccountId: registrationResult.moiAccountId,
    });

    // If session orchestration is not configured, fall back to simple workflow continue
    if (!this.requestClassifier || !this.sessionOrchestrator) {
      logger.debug('Session orchestration not configured, using simple workflow continue');
      await this.replyService.sendWorkflowContinue(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );

      return {
        success: true,
        messageId: message.messageId,
        action: 'workflow_continue',
        moiAccountId: registrationResult.moiAccountId,
      };
    }

    // Step 5: Classify the request
    const classification = this.requestClassifier.classify(message.text);

    logger.info('Request classified', {
      messageId: message.messageId,
      intent: classification.intent,
      requiredCategories: classification.requiredCategories,
      requiredScopes: classification.requiredScopes,
      confidence: classification.confidence,
    });

    // Step 6: Handle unknown intent
    if (classification.intent === IntentType.UNKNOWN) {
      logger.info('Unknown intent, cannot proceed with workflow', {
        messageId: message.messageId,
      });

      await this.replyService.sendUnknownIntent(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );

      return {
        success: true,
        messageId: message.messageId,
        action: 'unknown_intent',
        moiAccountId: registrationResult.moiAccountId,
      };
    }

    // Step 7: Orchestrate session
    const orchestrationResult = await this.sessionOrchestrator.orchestrate(
      registrationResult.moiAccountId!,
      message.channel,
      message.externalUserId,
      message.text,
      classification
    );

    logger.info('Session orchestration complete', {
      messageId: message.messageId,
      workflowId: orchestrationResult.workflowId,
      action: orchestrationResult.action,
      sessionId: orchestrationResult.sessionId,
    });

    // Step 8: Send appropriate reply based on orchestration result
    switch (orchestrationResult.action) {
      case 'session_found':
        await this.replyService.sendSessionActive(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          message.messageId
        );
        return {
          success: true,
          messageId: message.messageId,
          action: 'session_found',
          moiAccountId: registrationResult.moiAccountId,
          workflowId: orchestrationResult.workflowId,
          sessionId: orchestrationResult.sessionId,
        };

      case 'session_creation_required':
        await this.replyService.sendSessionCreationRequired(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          orchestrationResult.signingInstructions ?? 'Please sign the session request in your wallet.',
          message.messageId
        );
        return {
          success: true,
          messageId: message.messageId,
          action: 'session_creation_required',
          moiAccountId: registrationResult.moiAccountId,
          workflowId: orchestrationResult.workflowId,
          sessionId: orchestrationResult.sessionId,
        };

      case 'error':
      default:
        await this.replyService.sendInternalError(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          message.messageId
        );
        return {
          success: false,
          messageId: message.messageId,
          action: 'error',
          error: orchestrationResult.error,
          moiAccountId: registrationResult.moiAccountId,
          workflowId: orchestrationResult.workflowId,
        };
    }
  }

  /**
   * Handle a /register command
   */
  private async handleRegistrationCommand(
    message: InboundMessage
  ): Promise<ExtendedMessageProcessingResult> {
    logger.info('Processing registration command', {
      messageId: message.messageId,
      channel: message.channel,
      externalUserId: message.externalUserId,
    });

    if (!this.registrationService) {
      logger.error('Registration service not configured');
      await this.replyService.sendInternalError(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );
      return {
        success: false,
        messageId: message.messageId,
        action: 'error',
        error: 'Registration service not configured',
      };
    }

    // Process the registration
    const result = await this.registrationService.processRegistration(message.text, {
      channel: message.channel,
      externalUserId: message.externalUserId,
      senderName: message.senderName,
    });

    // Send appropriate reply based on result
    switch (result.action) {
      case 'registered':
        await this.replyService.sendRegistrationSuccess(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          result.moiAccountId!,
          message.messageId
        );
        return {
          success: true,
          messageId: message.messageId,
          action: 'registered',
          moiAccountId: result.moiAccountId,
        };

      case 'already_registered':
        await this.replyService.sendAlreadyRegistered(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          result.moiAccountId!,
          message.messageId
        );
        return {
          success: true,
          messageId: message.messageId,
          action: 'already_registered',
          moiAccountId: result.moiAccountId,
        };

      case 'invalid_payload':
      case 'verification_failed':
        await this.replyService.sendRegistrationFailed(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          result.error,
          message.messageId
        );
        return {
          success: false,
          messageId: message.messageId,
          action: 'registration_failed',
          error: result.error,
        };

      case 'error':
      default:
        await this.replyService.sendInternalError(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          message.messageId
        );
        return {
          success: false,
          messageId: message.messageId,
          action: 'error',
          error: result.error,
        };
    }
  }

  /**
   * Handle a /resume command
   */
  private async handleResumeCommand(
    message: InboundMessage
  ): Promise<ExtendedMessageProcessingResult> {
    logger.info('Processing resume command', {
      messageId: message.messageId,
      channel: message.channel,
      externalUserId: message.externalUserId,
    });

    // Check if resume handler is configured
    if (!this.resumeHandler) {
      logger.error('Resume handler not configured');
      await this.replyService.sendInternalError(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );
      return {
        success: false,
        messageId: message.messageId,
        action: 'error',
        error: 'Resume handler not configured',
      };
    }

    // Check if user is registered
    const registrationResult = await this.registrationChecker.check({
      channel: message.channel,
      externalUserId: message.externalUserId,
    });

    if (!registrationResult.isRegistered) {
      logger.warn('Unregistered user trying to resume', {
        messageId: message.messageId,
        channel: message.channel,
        externalUserId: message.externalUserId,
      });

      await this.replyService.sendRegistrationRequired(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );

      return {
        success: false,
        messageId: message.messageId,
        action: 'registration_required',
      };
    }

    // Parse the resume command
    const parseResult = parseResumeCommand(message.text);

    if (!parseResult.success || !parseResult.payload) {
      logger.warn('Failed to parse resume command', {
        messageId: message.messageId,
        error: parseResult.error,
      });

      await this.replyService.sendResumeError(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        parseResult.error ?? 'Invalid resume command format',
        message.messageId
      );

      return {
        success: false,
        messageId: message.messageId,
        action: 'error',
        error: parseResult.error,
      };
    }

    // Handle the resume
    const resumeResult = await this.resumeHandler.handleResume(
      parseResult.payload,
      registrationResult.moiAccountId!
    );

    logger.info('Resume handled', {
      messageId: message.messageId,
      workflowId: resumeResult.workflowId,
      action: resumeResult.action,
    });

    // Send appropriate reply based on result
    switch (resumeResult.action) {
      case 'session_active':
        await this.replyService.sendSessionResumed(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          resumeResult.message,
          message.messageId
        );
        return {
          success: true,
          messageId: message.messageId,
          action: 'session_resumed',
          moiAccountId: registrationResult.moiAccountId,
          workflowId: resumeResult.workflowId,
          sessionId: resumeResult.sessionId,
        };

      case 'pending':
        await this.replyService.sendSessionPending(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          resumeResult.message,
          message.messageId
        );
        return {
          success: true,
          messageId: message.messageId,
          action: 'session_pending',
          moiAccountId: registrationResult.moiAccountId,
          workflowId: resumeResult.workflowId,
        };

      case 'failed':
        await this.replyService.sendSessionFailed(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          resumeResult.message,
          message.messageId
        );
        return {
          success: false,
          messageId: message.messageId,
          action: 'session_failed',
          moiAccountId: registrationResult.moiAccountId,
          workflowId: resumeResult.workflowId,
        };

      case 'workflow_not_found':
      case 'error':
      default:
        await this.replyService.sendResumeError(
          message.channel,
          message.channelMeta,
          message.externalUserId,
          resumeResult.message,
          message.messageId
        );
        return {
          success: false,
          messageId: message.messageId,
          action: 'error',
          error: resumeResult.message,
          moiAccountId: registrationResult.moiAccountId,
        };
    }
  }
}

/**
 * Factory function to create WorkflowHandler
 */
export function createWorkflowHandler(
  registrationChecker: RegistrationChecker,
  replyService: ReplyService,
  registrationService?: RegistrationService,
  requestClassifier?: RequestClassifier,
  sessionOrchestrator?: SessionOrchestrator,
  resumeHandler?: ResumeHandler
): WorkflowHandler {
  return new WorkflowHandler(
    registrationChecker,
    replyService,
    registrationService,
    requestClassifier,
    sessionOrchestrator,
    resumeHandler
  );
}
