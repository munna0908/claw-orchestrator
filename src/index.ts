/**
 * Participant Orchestrator Plugin for OpenClaw
 *
 * A thin orchestration layer for participant-centric food-ordering workflow.
 *
 * This plugin:
 * - Receives inbound messages from OpenClaw channels (Telegram, WhatsApp)
 * - Handles user registration flow
 * - Checks participant registration status
 * - Classifies user requests and determines required permissions
 * - Orchestrates session validation and creation with Intelligence Service
 * - Routes registered users to workflow handling
 * - Delegates to external services for business logic
 *
 * External services:
 * - Intelligence Service: Session validation, write preparation
 * - Inference Service: LLM inference for responses (future)
 * - Delivery Service: Order delivery coordination (future)
 */

import type {
  InboundMessage,
  MockVerifierConfig,
  IntelligenceClientConfig,
  PrepareWriteResponse,
  SubmitWriteRequest,
  SubmitWriteResponse,
} from './types/index.js';
import type { ParticipantMappingStore } from './services/participant-mapping-store.js';
import type { ReplySender } from './services/reply-service.js';
import type { RegistrationVerifier } from './services/registration-verifier.js';
import type { IntelligenceClient } from './services/intelligence-client.js';
import type { SessionStore } from './stores/session-store.js';
import type { WorkflowStore } from './stores/workflow-store.js';
import type { ExtendedMessageProcessingResult } from './handlers/workflow-handler.js';

import { getConfig, loadConfig, type PluginConfig } from './config/index.js';
import { createLogger, logger } from './logger/index.js';
import { getInMemoryStore } from './stores/in-memory-store.js';
import { getSessionStore, resetSessionStore } from './stores/session-store.js';
import { getWorkflowStore, resetWorkflowStore } from './stores/workflow-store.js';
import { createRegistrationChecker, RegistrationChecker } from './services/registration-checker.js';
import { createReplyService, ReplyService, LoggingReplySender } from './services/reply-service.js';
import { createMessageRouter, MessageRouter } from './services/message-router.js';
import { createWorkflowHandler, WorkflowHandler } from './handlers/workflow-handler.js';
import { createRegistrationService, RegistrationService } from './services/registration-service.js';
import { createMockVerifier, MockRegistrationVerifier } from './services/registration-verifier.js';
import { createRequestClassifier, RequestClassifier } from './services/request-classifier.js';
import {
  createMockIntelligenceClient,
  type MockIntelligenceClientConfig,
} from './services/intelligence-client.js';
import { createSessionOrchestrator, SessionOrchestrator } from './services/session-orchestrator.js';
import { createResumeHandler, ResumeHandler } from './services/resume-handler.js';

const pluginLogger = createLogger('plugin');

/**
 * Session orchestration options
 */
export interface SessionOrchestrationOptions {
  /** Enable session orchestration (default: true if agentId provided) */
  enabled?: boolean;

  /** Agent ID for this plugin instance (required for session orchestration) */
  agentId?: string;

  /** Custom Intelligence Service client */
  intelligenceClient?: IntelligenceClient;

  /** Configuration for mock Intelligence client (used if no custom client provided) */
  mockIntelligenceConfig?: MockIntelligenceClientConfig;

  /** Custom session store */
  sessionStore?: SessionStore;

  /** Custom workflow store */
  workflowStore?: WorkflowStore;

  /** Default requested uses for new sessions */
  defaultRequestedUses?: number;

  /** Default TTL in seconds for new sessions */
  defaultTtlSeconds?: number;

  /** Default key ID for signing */
  defaultKeyId?: number;

  /** Anthropic API key for LLM-based request classification (falls back to keyword matching if omitted) */
  classifierApiKey?: string;

  /** Claude model for request classification (default: claude-haiku-4-5-20251001) */
  classifierModel?: string;
}

/**
 * Plugin options for initialization
 */
export interface PluginOptions {
  /** Custom participant mapping store (default: in-memory) */
  participantStore?: ParticipantMappingStore;

  /** Custom reply sender (default: logging sender) */
  replySender?: ReplySender;

  /** Custom registration verifier (default: mock verifier) */
  registrationVerifier?: RegistrationVerifier;

  /** Configuration for mock verifier (used if no custom verifier provided) */
  mockVerifierConfig?: MockVerifierConfig;

  /** Session orchestration options */
  sessionOrchestration?: SessionOrchestrationOptions;
}

/**
 * ParticipantOrchestratorPlugin
 *
 * Main plugin class that wires up all components and exposes
 * the message handling interface to OpenClaw.
 */
export class ParticipantOrchestratorPlugin {
  private readonly config: PluginConfig;
  private readonly store: ParticipantMappingStore;
  private readonly registrationChecker: RegistrationChecker;
  private readonly replyService: ReplyService;
  private readonly registrationService: RegistrationService;
  private readonly workflowHandler: WorkflowHandler;
  private readonly messageRouter: MessageRouter;

  // Session orchestration components (optional)
  private readonly requestClassifier?: RequestClassifier;
  private readonly intelligenceClient?: IntelligenceClient;
  private readonly sessionStore?: SessionStore;
  private readonly workflowStore?: WorkflowStore;
  private readonly sessionOrchestrator?: SessionOrchestrator;
  private readonly resumeHandler?: ResumeHandler;

  constructor(options: PluginOptions = {}) {
    // Load configuration
    this.config = loadConfig();

    pluginLogger.info('Initializing participant-orchestrator plugin', {
      env: this.config.env,
      channels: this.config.channels,
    });

    // Initialize store (default: in-memory)
    this.store = options.participantStore ?? getInMemoryStore();

    // Initialize registration verifier (default: mock)
    const verifier = options.registrationVerifier ?? createMockVerifier(options.mockVerifierConfig);

    // Initialize services
    this.registrationChecker = createRegistrationChecker(this.store);
    this.replyService = createReplyService(options.replySender);
    this.registrationService = createRegistrationService(verifier, this.store);

    // Initialize session orchestration if enabled
    const sessionOpts = options.sessionOrchestration;
    const sessionEnabled = sessionOpts?.enabled !== false && !!sessionOpts?.agentId;

    if (sessionEnabled && sessionOpts?.agentId) {
      pluginLogger.info('Initializing session orchestration', {
        agentId: sessionOpts.agentId,
      });

      // Initialize request classifier
      this.requestClassifier = createRequestClassifier({
        ...(sessionOpts.classifierApiKey ? { apiKey: sessionOpts.classifierApiKey } : {}),
        ...(sessionOpts.classifierModel ? { model: sessionOpts.classifierModel } : {}),
      });

      // Initialize Intelligence client (default: mock)
      this.intelligenceClient =
        sessionOpts.intelligenceClient ??
        createMockIntelligenceClient(sessionOpts.mockIntelligenceConfig);

      // Initialize stores
      this.sessionStore = sessionOpts.sessionStore ?? getSessionStore();
      this.workflowStore = sessionOpts.workflowStore ?? getWorkflowStore();

      // Initialize session orchestrator
      const orchestratorConfig: Parameters<typeof createSessionOrchestrator>[3] = {
        agentId: sessionOpts.agentId,
      };
      if (sessionOpts.defaultRequestedUses !== undefined) {
        orchestratorConfig.defaultRequestedUses = sessionOpts.defaultRequestedUses;
      }
      if (sessionOpts.defaultTtlSeconds !== undefined) {
        orchestratorConfig.defaultTtlSeconds = sessionOpts.defaultTtlSeconds;
      }
      if (sessionOpts.defaultKeyId !== undefined) {
        orchestratorConfig.defaultKeyId = sessionOpts.defaultKeyId;
      }

      this.sessionOrchestrator = createSessionOrchestrator(
        this.intelligenceClient,
        this.sessionStore,
        this.workflowStore,
        orchestratorConfig
      );

      // Initialize resume handler
      this.resumeHandler = createResumeHandler(
        this.intelligenceClient,
        this.sessionStore,
        this.workflowStore
      );

      pluginLogger.info('Session orchestration initialized');
    } else {
      pluginLogger.info('Session orchestration disabled (no agentId provided)');
    }

    // Initialize handlers
    this.workflowHandler = createWorkflowHandler(
      this.registrationChecker,
      this.replyService,
      this.registrationService,
      this.requestClassifier,
      this.sessionOrchestrator,
      this.resumeHandler
    );

    // Initialize router
    this.messageRouter = createMessageRouter(this.workflowHandler);

    pluginLogger.info('Plugin initialized successfully');
  }

  /**
   * Get plugin name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Get plugin version
   */
  get version(): string {
    return '0.3.0';
  }

  /**
   * Handle an inbound message from OpenClaw
   *
   * This is the main entry point for message processing.
   */
  async handleMessage(message: InboundMessage): Promise<ExtendedMessageProcessingResult> {
    return this.messageRouter.route(message) as Promise<ExtendedMessageProcessingResult>;
  }

  /**
   * Get the participant mapping store (for direct access if needed)
   */
  getParticipantStore(): ParticipantMappingStore {
    return this.store;
  }

  /**
   * Get the registration service (for direct access if needed)
   */
  getRegistrationService(): RegistrationService {
    return this.registrationService;
  }

  /**
   * Get the session store (if session orchestration is enabled)
   */
  getSessionStore(): SessionStore | undefined {
    return this.sessionStore;
  }

  /**
   * Get the workflow store (if session orchestration is enabled)
   */
  getWorkflowStore(): WorkflowStore | undefined {
    return this.workflowStore;
  }

  /**
   * Get the session orchestrator (if session orchestration is enabled)
   */
  getSessionOrchestrator(): SessionOrchestrator | undefined {
    return this.sessionOrchestrator;
  }

  /**
   * Check if session orchestration is enabled
   */
  isSessionOrchestrationEnabled(): boolean {
    return !!this.sessionOrchestrator;
  }

  /**
   * Submit a signed write operation to the Intelligence Service.
   * Channel adapters call this after the participant signs the ixObject in their wallet.
   */
  async submitWrite(request: SubmitWriteRequest): Promise<SubmitWriteResponse> {
    if (!this.intelligenceClient) {
      throw new Error('Session orchestration is not enabled');
    }
    return this.intelligenceClient.submitWrite(request);
  }

  /**
   * Get the on-chain status of a submitted write transaction.
   * Channel adapters use this to poll for confirmation after submitWrite.
   */
  async getWriteStatus(txHash: string): Promise<import('./types/intelligence.js').WriteStatusResponse> {
    if (!this.intelligenceClient) {
      throw new Error('Session orchestration is not enabled');
    }
    return this.intelligenceClient.getWriteStatus(txHash);
  }

  /**
   * Prepare a revoke_session interaction for the participant to sign.
   * Returns the ixObject that the channel adapter must send to the wallet for signing.
   */
  async prepareRevoke(participantId: string, sessionId: string): Promise<PrepareWriteResponse> {
    if (!this.intelligenceClient) {
      throw new Error('Session orchestration is not enabled');
    }
    const requestId = `req_revoke_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    return this.intelligenceClient.prepareWrite({
      requestId,
      participantId,
      action: 'revoke_session',
      params: { sessionId },
    });
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ status: 'ok' | 'error'; details?: Record<string, unknown> }> {
    try {
      // Basic health check - verify store is accessible
      await this.store.lookup({ channel: 'telegram', externalUserId: '__health_check__' });

      return {
        status: 'ok',
        details: {
          plugin: this.name,
          version: this.version,
          env: this.config.env,
          features: {
            registration: true,
            sessionOrchestration: this.isSessionOrchestrationEnabled(),
          },
        },
      };
    } catch (error) {
      return {
        status: 'error',
        details: {
          error: (error as Error).message,
        },
      };
    }
  }
}

/**
 * Create and initialize the plugin
 *
 * Usage with OpenClaw:
 *
 * ```typescript
 * import { createPlugin } from '@openclaw/participant-orchestrator';
 *
 * const plugin = createPlugin({
 *   sessionOrchestration: {
 *     agentId: 'openclaw_telegram_bot',
 *   },
 * });
 *
 * // Register with OpenClaw
 * openclaw.registerPlugin(plugin);
 * ```
 */
export function createPlugin(options?: PluginOptions): ParticipantOrchestratorPlugin {
  return new ParticipantOrchestratorPlugin(options);
}

// Re-export types and utilities for external use
export * from './types/index.js';
export { getConfig, type PluginConfig } from './config/index.js';
export { createLogger, logger, type Logger } from './logger/index.js';
export { type ParticipantMappingStore } from './services/participant-mapping-store.js';
export { type ReplySender, ReplyMessages } from './services/reply-service.js';
export { getInMemoryStore, resetInMemoryStore } from './stores/in-memory-store.js';
export { HttpParticipantMappingStore } from './stores/http-participant-store.js';
export {
  type RegistrationVerifier,
  MockRegistrationVerifier,
  createMockVerifier,
  CryptoRegistrationVerifier,
  createCryptoVerifier,
} from './services/registration-verifier.js';
export { RegistrationService, createRegistrationService } from './services/registration-service.js';
export {
  parseRegistrationCommand,
  isRegistrationCommand,
  createExpectedSignedMessage,
  REGISTRATION_COMMAND,
} from './services/registration-parser.js';
export type { ExtendedMessageProcessingResult } from './handlers/workflow-handler.js';
export type { PrepareWriteResponse, SubmitWriteRequest, SubmitWriteResponse, WriteStatusResponse } from './types/intelligence.js';

// Session orchestration exports
export {
  type IntelligenceClient,
  HttpIntelligenceClient,
  MockIntelligenceClient,
  createIntelligenceClient,
  createMockIntelligenceClient,
  type MockIntelligenceClientConfig,
} from './services/intelligence-client.js';
export {
  RequestClassifier,
  createRequestClassifier,
} from './services/request-classifier.js';
export {
  type SessionStore,
  InMemorySessionStore,
  getSessionStore,
  resetSessionStore,
  createSessionStore,
} from './stores/session-store.js';
export {
  type WorkflowStore,
  InMemoryWorkflowStore,
  getWorkflowStore,
  resetWorkflowStore,
  createWorkflowStore,
} from './stores/workflow-store.js';
export {
  SessionOrchestrator,
  createSessionOrchestrator,
  type SessionOrchestratorConfig,
} from './services/session-orchestrator.js';
export {
  ResumeHandler,
  createResumeHandler,
  isResumeCommand,
  parseResumeCommand,
  RESUME_COMMAND,
} from './services/resume-handler.js';

// Restaurant selector
export {
  RestaurantSelector,
  createRestaurantSelector,
  type RestaurantSelectorConfig,
  type SelectedRestaurant,
  type DishOption,
  type RequestClassification,
} from './services/restaurant-selector.js';

// Default export for convenience
export default createPlugin;
