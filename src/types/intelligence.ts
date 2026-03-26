/**
 * Intelligence Service API Types
 */

/**
 * Request to validate a session
 * POST /v1/sessions/validate
 */
export interface ValidateSessionRequest {
  /** MOI participant ID */
  participantId: string;

  /** Agent identifier (e.g., "openclaw_whatsapp_bot") */
  agentId: string;

  /** Session ID to validate */
  sessionId: string;

  /** Required permission categories */
  requiredCategories: string[];

  /** Required permission scopes */
  requiredScopes: string[];

  /** Current timestamp (Unix seconds) */
  currentTime: number;
}

/**
 * Response from session validation
 */
export interface ValidateSessionResponse {
  /** Whether the session is valid */
  valid: boolean;

  /** Reason for invalidity if not valid */
  reason: string | null;
}

/**
 * Request to prepare a write operation
 * POST /v1/writes/prepare
 */
export interface PrepareWriteRequest {
  /** Unique request identifier */
  requestId: string;

  /** MOI participant ID */
  participantId: string;

  /** Action type */
  action: 'create_session_request';

  /** Action-specific parameters */
  params: CreateSessionRequestParams;
}

/**
 * Parameters for create_session_request action
 */
export interface CreateSessionRequestParams {
  /** New session ID */
  sessionId: string;

  /** Agent identifier */
  agentId: string;

  /** Purpose of the session */
  purpose: string;

  /** Required permission categories (matches intelligence service schema) */
  requiredCategories: string[];

  /** Required permission scopes (matches intelligence service schema) */
  requiredScopes: string[];

  /** Requested number of uses */
  requestedUses: number;

  /** Time to live in seconds */
  ttlSeconds: number;
}

/**
 * Response from prepare write
 */
export interface PrepareWriteResponse {
  /** Request ID */
  requestId: string;

  /** Status — always 'ready_to_sign' on success (service throws on failure) */
  status: 'ready_to_sign';

  /** Contract method name */
  method: string;

  /** The InteractionObject to be signed by the participant's wallet */
  ixObject: Record<string, unknown>;

  /** Human-readable summary */
  summary: string;

  /** Unix timestamp when this prepare request expires */
  expiresAt: number;
}

/**
 * Write status values
 */
export const WriteStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const;

export type WriteStatus = (typeof WriteStatus)[keyof typeof WriteStatus];

/**
 * Response from write status check
 * GET /v1/writes/status/:txHash
 */
export interface WriteStatusResponse {
  /** Transaction hash */
  txHash: string;

  /** Current status */
  status: WriteStatus;

  /** Block number if confirmed */
  blockNumber?: number | undefined;

  /** Error message if failed */
  error?: string | undefined;

  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * Request to submit a signed write operation
 * POST /v1/writes/submit
 */
export interface SubmitWriteRequest {
  /** Request ID from prepareWrite */
  requestId: string;

  /** MOI participant ID */
  participantId: string;

  /** Action type */
  action: 'create_session_request';

  /** Signed interaction object from wallet */
  signedIx: {
    ix_args: string;
    signatures: string;
  };
}

/**
 * Response from submit write
 */
export interface SubmitWriteResponse {
  /** Request ID */
  requestId: string;

  /** Status */
  status: 'submitted' | 'failed';

  /** Transaction hash (present when status === 'submitted') */
  txHash?: string | undefined;

  /** Human-readable message */
  message: string;
}

/**
 * Intelligence Service client configuration
 */
export interface IntelligenceClientConfig {
  /** Base URL of the Intelligence Service */
  baseUrl: string;

  /** Agent ID for this plugin instance */
  agentId: string;

  /** Request timeout in milliseconds */
  timeoutMs?: number;

  /** API key if required */
  apiKey?: string;
}
