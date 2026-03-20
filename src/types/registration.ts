import type { ChannelType } from './channel.js';

/**
 * Registration payload sent by the user
 * Format: /register {"accountId":"...","publicKey":"...","signature":"...","message":"..."}
 */
export interface RegistrationPayload {
  /** MOI account identifier */
  accountId: string;

  /** Public key for signature verification */
  publicKey: string;

  /** Cryptographic signature */
  signature: string;

  /** Signed message (e.g., "register:telegram_user_456") */
  message: string;
}

/**
 * Context for verification (channel info, user info)
 */
export interface VerificationContext {
  /** Channel where registration is happening */
  channel: ChannelType;

  /** External user ID from the channel */
  externalUserId: string;

  /** Optional: display name of the user */
  senderName?: string | undefined;
}

/**
 * Result of registration payload parsing
 */
export interface RegistrationParseResult {
  /** Whether parsing succeeded */
  success: boolean;

  /** Parsed payload if successful */
  payload?: RegistrationPayload | undefined;

  /** Error message if parsing failed */
  error?: string | undefined;

  /** Specific field that caused the error */
  errorField?: string | undefined;
}

/**
 * Result of signature verification
 */
export interface VerificationResult {
  /** Whether verification succeeded */
  valid: boolean;

  /** Error message if verification failed */
  error?: string | undefined;

  /** Additional details about the verification */
  details?: Record<string, unknown> | undefined;
}

/**
 * Result of the full registration flow
 */
export interface RegistrationResult {
  /** Whether registration succeeded */
  success: boolean;

  /** Action taken */
  action: 'registered' | 'already_registered' | 'invalid_payload' | 'verification_failed' | 'error';

  /** MOI account ID if successful */
  moiAccountId?: string | undefined;

  /** Error message if failed */
  error?: string | undefined;
}

/**
 * Configuration for the mock registration verifier
 */
export interface MockVerifierConfig {
  /** Accept all well-formed payloads without signature check */
  acceptAllValid?: boolean;

  /** List of test signatures that should be accepted */
  acceptedTestSignatures?: string[];

  /** List of account IDs to reject (for testing) */
  rejectedAccountIds?: string[];

  /** Simulate verification delay in milliseconds */
  simulatedDelayMs?: number;
}
