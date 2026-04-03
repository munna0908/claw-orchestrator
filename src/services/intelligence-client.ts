import type {
  ValidateSessionRequest,
  ValidateSessionResponse,
  PrepareWriteRequest,
  PrepareWriteResponse,
  SubmitWriteRequest,
  SubmitWriteResponse,
  WriteStatusResponse,
  IntelligenceClientConfig,
  GetCategoryRefsRequest,
  GetCategoryRefsResponse,
} from '../types/intelligence.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('intelligence-client');

/**
 * Intelligence Service Client Interface
 *
 * Defines the contract for communicating with the Intelligence Service.
 * Allows for real and mock implementations.
 */
export interface IntelligenceClient {
  /**
   * Validate a session against required permissions
   */
  validateSession(
    participantId: string,
    agentId: string,
    sessionId: string,
    requiredCategories: string[],
    requiredScopes: string[],
    currentTime: number
  ): Promise<ValidateSessionResponse>;

  /**
   * Prepare a write operation (e.g., create_session_request)
   */
  prepareWrite(request: PrepareWriteRequest): Promise<PrepareWriteResponse>;

  /**
   * Submit a signed write operation
   */
  submitWrite(request: SubmitWriteRequest): Promise<SubmitWriteResponse>;

  /**
   * Get the status of a write operation
   */
  getWriteStatus(txHash: string): Promise<WriteStatusResponse>;

  /**
   * Fetch category CID references for a participant from the contract
   * Used to check if required categories have CIDs set before creating a session request
   */
  getCategoryRefs(
    participantId: string,
    categories: string[]
  ): Promise<GetCategoryRefsResponse>;
}

/**
 * HTTP Intelligence Service Client
 *
 * Real implementation that calls the Intelligence Service APIs.
 */
export class HttpIntelligenceClient implements IntelligenceClient {
  private readonly config: Required<IntelligenceClientConfig>;

  constructor(config: IntelligenceClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      agentId: config.agentId,
      timeoutMs: config.timeoutMs ?? 30000,
      apiKey: config.apiKey ?? '',
    };

    logger.info('HttpIntelligenceClient initialized', {
      baseUrl: this.config.baseUrl,
      agentId: this.config.agentId,
    });
  }

  async validateSession(
    participantId: string,
    agentId: string,
    sessionId: string,
    requiredCategories: string[],
    requiredScopes: string[],
    currentTime: number
  ): Promise<ValidateSessionResponse> {
    const request: ValidateSessionRequest = {
      participantId,
      agentId,
      sessionId,
      requiredCategories,
      requiredScopes,
      currentTime,
    };

    logger.debug('Validating session', {
      participantId,
      sessionId,
      requiredCategories,
      requiredScopes,
    });

    try {
      const response = await this.fetch('/v1/sessions/validate', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      const result = (await response.json()) as ValidateSessionResponse;

      logger.info('Session validation result', {
        participantId,
        sessionId,
        valid: result.valid,
        reason: result.reason,
      });

      return result;
    } catch (error) {
      logger.error('Failed to validate session', error as Error, {
        participantId,
        sessionId,
      });
      throw error;
    }
  }

  async prepareWrite(request: PrepareWriteRequest): Promise<PrepareWriteResponse> {
    logger.debug('Preparing write', {
      requestId: request.requestId,
      participantId: request.participantId,
      action: request.action,
    });

    try {
      const response = await this.fetch('/v1/writes/prepare', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      const result = (await response.json()) as PrepareWriteResponse;

      logger.info('Write preparation result', {
        requestId: request.requestId,
        status: result.status,
        method: result.method,
      });

      return result;
    } catch (error) {
      logger.error('Failed to prepare write', error as Error, {
        requestId: request.requestId,
      });
      throw error;
    }
  }

  async submitWrite(request: SubmitWriteRequest): Promise<SubmitWriteResponse> {
    logger.debug('Submitting write', {
      requestId: request.requestId,
      participantId: request.participantId,
      action: request.action,
    });

    try {
      const response = await this.fetch('/v1/writes/submit', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      const result = (await response.json()) as SubmitWriteResponse;

      logger.info('Write submit result', {
        requestId: request.requestId,
        status: result.status,
        txHash: result.txHash,
      });

      return result;
    } catch (error) {
      logger.error('Failed to submit write', error as Error, {
        requestId: request.requestId,
      });
      throw error;
    }
  }

  async getWriteStatus(txHash: string): Promise<WriteStatusResponse> {
    logger.debug('Getting write status', { txHash });

    try {
      const response = await this.fetch(`/v1/writes/status/${txHash}`, {
        method: 'GET',
      });

      const result = (await response.json()) as WriteStatusResponse;

      logger.info('Write status result', {
        txHash,
        status: result.status,
      });

      return result;
    } catch (error) {
      logger.error('Failed to get write status', error as Error, { txHash });
      throw error;
    }
  }

  async getCategoryRefs(
    participantId: string,
    categories: string[]
  ): Promise<GetCategoryRefsResponse> {
    const request: GetCategoryRefsRequest = { participantId, categories };

    logger.debug('Fetching category refs', { participantId, categories });

    try {
      const response = await this.fetch('/v1/categories/get', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      const result = (await response.json()) as GetCategoryRefsResponse;

      logger.info('Category refs fetched', {
        participantId,
        foundCategories: Object.keys(result.categoryRefs ?? {}),
      });

      return result;
    } catch (error) {
      logger.error('Failed to fetch category refs', error as Error, { participantId });
      throw error;
    }
  }

  private async fetch(path: string, options: RequestInit): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers as Record<string, string>),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let body: string;
        try {
          body = await response.text();
        } catch {
          body = '<unreadable>';
        }
        logger.error('HTTP error response', undefined, {
          url,
          status: response.status,
          statusText: response.statusText,
          body,
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Mock Intelligence Service Client
 *
 * For development and testing.
 */
export interface MockIntelligenceClientConfig {
  /** Sessions that should be considered valid */
  validSessions?: Map<string, string[]>; // participantId -> sessionIds

  /** Whether to auto-approve session creation */
  autoApproveSessionCreation?: boolean;

  /** Simulated delay in milliseconds */
  simulatedDelayMs?: number;

  /** Force specific write status responses */
  writeStatuses?: Map<string, WriteStatusResponse>;
}

export class MockIntelligenceClient implements IntelligenceClient {
  private readonly config: MockIntelligenceClientConfig;
  private preparedWrites: Map<string, PrepareWriteRequest> = new Map<string, PrepareWriteRequest>();

  constructor(config: MockIntelligenceClientConfig = {}) {
    this.config = {
      validSessions: config.validSessions ?? new Map(),
      autoApproveSessionCreation: config.autoApproveSessionCreation ?? true,
      simulatedDelayMs: config.simulatedDelayMs ?? 0,
      writeStatuses: config.writeStatuses ?? new Map(),
    };

    logger.info('MockIntelligenceClient initialized', {
      validSessionsCount: this.config.validSessions?.size ?? 0,
      autoApproveSessionCreation: this.config.autoApproveSessionCreation,
    });
  }

  async validateSession(
    participantId: string,
    _agentId: string,
    sessionId: string,
    _requiredCategories: string[],
    _requiredScopes: string[],
    _currentTime: number
  ): Promise<ValidateSessionResponse> {
    await this.simulateDelay();

    const validSessionIds = this.config.validSessions?.get(participantId) ?? [];
    const isValid = validSessionIds.includes(sessionId);

    logger.debug('Mock session validation', {
      participantId,
      sessionId,
      valid: isValid,
    });

    if (isValid) {
      return { valid: true, reason: null };
    }

    return { valid: false, reason: 'session_not_found_or_expired' };
  }

  async prepareWrite(request: PrepareWriteRequest): Promise<PrepareWriteResponse> {
    await this.simulateDelay();

    // Store the request for later reference
    this.preparedWrites.set(request.requestId, request);

    logger.debug('Mock write preparation', {
      requestId: request.requestId,
      action: request.action,
    });

    let summary: string;
    let method: string;
    if (request.action === 'create_session_request') {
      summary = `Create session ${request.params.sessionId} for ${request.params.purpose}`;
      method = 'CreateSessionRequest';
    } else if (request.action === 'approve_session') {
      summary = `Approve session ${request.params.sessionId}`;
      method = 'ApproveSession';
    } else {
      summary = `Revoke session ${request.params.sessionId}`;
      method = 'RevokeSession';
    }

    return {
      requestId: request.requestId,
      status: 'ready_to_sign',
      summary,
      method,
      ixObject: { mock: true, requestId: request.requestId, action: request.action },
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    };
  }

  async submitWrite(request: SubmitWriteRequest): Promise<SubmitWriteResponse> {
    await this.simulateDelay();

    logger.debug('Mock write submit', {
      requestId: request.requestId,
      action: request.action,
    });

    const txHash = `mock_tx_${request.requestId}`;
    return { requestId: request.requestId, status: 'submitted', txHash, message: 'Transaction submitted successfully' };
  }

  async getWriteStatus(txHash: string): Promise<WriteStatusResponse> {
    await this.simulateDelay();

    // Check if there's a configured status for this txHash
    const configuredStatus = this.config.writeStatuses?.get(txHash);
    if (configuredStatus) {
      return configuredStatus;
    }

    // Default: auto-confirm if configured
    if (this.config.autoApproveSessionCreation) {
      return {
        txHash,
        status: 'confirmed',
        blockNumber: 12345,
        updatedAt: Math.floor(Date.now() / 1000),
      };
    }

    return {
      txHash,
      status: 'pending',
      updatedAt: Math.floor(Date.now() / 1000),
    };
  }

  async getCategoryRefs(
    participantId: string,
    categories: string[]
  ): Promise<GetCategoryRefsResponse> {
    await this.simulateDelay();

    // Mock: return all categories as having CIDs set by default
    const categoryRefs: Partial<Record<string, { ref: string; schemaVersion: string; updatedAt: number, updatedBy: string }>> = {};
    for (const category of categories) {
      categoryRefs[category] = {
        ref: `mock_cid_${category.toLowerCase()}`,
        schemaVersion: '1.0',
        updatedAt: Math.floor(Date.now() / 1000),
        updatedBy: "external_app"
      };
    }

    return { participantId, categoryRefs };
  }

  /**
   * Add a valid session for testing
   */
  addValidSession(participantId: string, sessionId: string): void {
    if (!this.config.validSessions) {
      this.config.validSessions = new Map();
    }

    const sessions = this.config.validSessions.get(participantId) ?? [];
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId);
      this.config.validSessions.set(participantId, sessions);
    }
  }

  /**
   * Set write status for testing
   */
  setWriteStatus(txHash: string, status: WriteStatusResponse): void {
    if (!this.config.writeStatuses) {
      this.config.writeStatuses = new Map();
    }
    this.config.writeStatuses.set(txHash, status);
  }

  private async simulateDelay(): Promise<void> {
    if (this.config.simulatedDelayMs && this.config.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.simulatedDelayMs));
    }
  }
}

/**
 * Factory function to create an HTTP Intelligence Client
 */
export function createIntelligenceClient(
  config: IntelligenceClientConfig
): HttpIntelligenceClient {
  return new HttpIntelligenceClient(config);
}

/**
 * Factory function to create a Mock Intelligence Client
 */
export function createMockIntelligenceClient(
  config?: MockIntelligenceClientConfig
): MockIntelligenceClient {
  return new MockIntelligenceClient(config);
}
