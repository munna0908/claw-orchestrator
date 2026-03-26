import type { ChannelType } from './channel.js';

/**
 * Workflow status states
 */
export const WorkflowStatus = {
  NEW: 'NEW',
  CHECKING_SESSIONS: 'CHECKING_SESSIONS',
  SESSION_ACTIVE: 'SESSION_ACTIVE',
  SESSION_REQUIRED: 'SESSION_REQUIRED',
  WAITING_FOR_SIGNATURE: 'WAITING_FOR_SIGNATURE',
  WAITING_FOR_CONFIRMATION: 'WAITING_FOR_CONFIRMATION',
  READY_FOR_INFERENCE: 'READY_FOR_INFERENCE',
  FAILED: 'FAILED',
} as const;

export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

/**
 * Intent types supported by the classifier
 */
export const IntentType = {
  FOOD_ORDERING: 'food_ordering',
  UNKNOWN: 'unknown',
} as const;

export type IntentType = (typeof IntentType)[keyof typeof IntentType];

/**
 * Permission categories
 */
export const PermissionCategory = {
  FOOD: 'FOOD',
  HEALTH: 'HEALTH',
  ADDRESS: 'ADDRESS',
  PAYMENT: 'PAYMENT',
} as const;

export type PermissionCategory = (typeof PermissionCategory)[keyof typeof PermissionCategory];

/**
 * Classification result from the request classifier
 */
export interface ClassificationResult {
  /** Detected intent */
  intent: IntentType;

  /** Required permission categories */
  requiredCategories: string[];

  /** Required permission scopes */
  requiredScopes: string[];

  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Workflow record stored in the workflow store
 */
export interface WorkflowRecord {
  /** Unique workflow identifier */
  workflowId: string;

  /** Request identifier for tracking */
  requestId: string;

  /** MOI participant ID */
  participantId: string;

  /** Source channel */
  channel: ChannelType;

  /** External user ID from channel */
  externalUserId: string;

  /** Original user message */
  originalMessage: string;

  /** Classified intent */
  intent: IntentType;

  /** Required permission categories */
  requiredCategories: string[];

  /** Required permission scopes */
  requiredScopes: string[];

  /** Selected or created session ID */
  sessionId?: string | undefined;

  /** Transaction hash for session creation */
  txHash?: string | undefined;

  /** Current workflow status */
  status: WorkflowStatus;

  /** Signing payload from prepare (for reference) */
  signingPayload?: Record<string, unknown> | undefined;

  /** Timestamp when workflow was created */
  createdAt: Date;

  /** Timestamp when workflow was last updated */
  updatedAt: Date;
}

/**
 * Input for creating a new workflow
 */
export interface CreateWorkflowInput {
  participantId: string;
  channel: ChannelType;
  externalUserId: string;
  originalMessage: string;
  intent: IntentType;
  requiredCategories: string[];
  requiredScopes: string[];
}

/**
 * Input for updating a workflow
 */
export interface UpdateWorkflowInput {
  status?: WorkflowStatus;
  sessionId?: string;
  txHash?: string;
  signingPayload?: Record<string, unknown>;
}

/**
 * Resume command payload
 */
export interface ResumePayload {
  workflowId: string;
  sessionId: string;
  txHash: string;
}

/**
 * Result of resume command parsing
 */
export interface ResumeParseResult {
  success: boolean;
  payload?: ResumePayload | undefined;
  error?: string | undefined;
}