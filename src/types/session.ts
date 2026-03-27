/**
 * Session record stored in the local session store
 */
export interface SessionRecord {
  /** MOI participant ID */
  participantId: string;

  /** List of known session IDs for this participant */
  sessionIds: string[];

  /** Timestamp when record was created */
  createdAt: Date;

  /** Timestamp when record was last updated */
  updatedAt: Date;
}

/**
 * Result of session selection
 */
export interface SessionSelectionResult {
  /** Whether a valid session was found */
  found: boolean;

  /** The valid session ID if found */
  sessionId?: string | undefined;

  /** Session IDs that were checked */
  checkedSessionIds: string[];

  /** Reasons for invalid sessions */
  invalidReasons: Record<string, string>;
}

/**
 * Session orchestration result
 */
export interface SessionOrchestrationResult {
  /** Whether orchestration succeeded */
  success: boolean;

  /** Action taken */
  action:
    | 'session_found'
    | 'session_creation_required'
    | 'waiting_for_signature'
    | 'category_cids_missing'
    | 'error';

  /** Workflow ID */
  workflowId: string;

  /** Session ID if found or created */
  sessionId?: string | undefined;

  /** Signing instructions if session creation required */
  signingInstructions?: string | undefined;

  /** The InteractionObject to sign (present when action === 'session_creation_required') */
  ixObject?: Record<string, unknown> | undefined;

  /** Request ID for the prepare write (needed for submit) */
  requestId?: string | undefined;

  /** Categories missing CIDs in the contract (present when action === 'category_cids_missing') */
  missingCategories?: string[] | undefined;

  /** Error message if failed */
  error?: string | undefined;
}

/**
 * Resume result
 */
export interface ResumeResult {
  /** Whether resume succeeded */
  success: boolean;

  /** Action taken */
  action:
    | 'session_active'
    | 'pending'
    | 'failed'
    | 'workflow_not_found'
    | 'error';

  /** Workflow ID */
  workflowId: string;

  /** Session ID if confirmed */
  sessionId?: string | undefined;

  /** Message to display to user */
  message: string;
}
