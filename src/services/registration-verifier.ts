import type {
  RegistrationPayload,
  VerificationContext,
  VerificationResult,
  MockVerifierConfig,
} from '../types/registration.js';
import { createExpectedSignedMessage } from './registration-parser.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('registration-verifier');

/**
 * Registration Verifier Interface
 *
 * This interface allows pluggable verification implementations:
 * - MockRegistrationVerifier (v1, development/testing)
 * - ExternalRegistrationVerifier (future, delegates to backend service)
 * - CryptoRegistrationVerifier (future, local cryptographic verification)
 *
 * The plugin orchestrates registration but does not own cryptographic truth.
 * This design allows verification to be delegated to another backend later.
 */
export interface RegistrationVerifier {
  /**
   * Verify a registration payload
   *
   * @param payload - The registration payload to verify
   * @param context - Context about the registration (channel, user, etc.)
   * @returns Verification result
   */
  verify(payload: RegistrationPayload, context: VerificationContext): Promise<VerificationResult>;
}

/**
 * Mock Registration Verifier
 *
 * A configurable mock implementation for development and testing.
 *
 * Behavior:
 * - If acceptAllValid is true, accepts any well-formed payload
 * - If acceptedTestSignatures is set, only accepts those signatures
 * - If rejectedAccountIds is set, rejects those account IDs
 * - Can simulate verification delay for testing async behavior
 */
export class MockRegistrationVerifier implements RegistrationVerifier {
  private readonly config: MockVerifierConfig;

  constructor(config: MockVerifierConfig = {}) {
    this.config = {
      acceptAllValid: true,
      acceptedTestSignatures: [],
      rejectedAccountIds: [],
      simulatedDelayMs: 0,
      ...config,
    };

    logger.info('MockRegistrationVerifier initialized', {
      acceptAllValid: this.config.acceptAllValid,
      acceptedTestSignaturesCount: this.config.acceptedTestSignatures?.length ?? 0,
      rejectedAccountIdsCount: this.config.rejectedAccountIds?.length ?? 0,
    });
  }

  async verify(
    payload: RegistrationPayload,
    context: VerificationContext
  ): Promise<VerificationResult> {
    logger.debug('Verifying registration payload', {
      accountId: payload.accountId,
      channel: context.channel,
      externalUserId: context.externalUserId,
    });

    // Simulate delay if configured
    if (this.config.simulatedDelayMs && this.config.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.simulatedDelayMs));
    }

    // Check rejected account IDs
    if (this.config.rejectedAccountIds?.includes(payload.accountId)) {
      logger.debug('Account ID is in rejected list', { accountId: payload.accountId });
      return {
        valid: false,
        error: 'Account ID is not allowed',
        details: { reason: 'rejected_account' },
      };
    }

    // Validate message format
    const expectedMessage = createExpectedSignedMessage(context.channel, context.externalUserId);
    if (payload.message !== expectedMessage) {
      logger.debug('Message format mismatch', {
        expected: expectedMessage,
        received: payload.message,
      });
      return {
        valid: false,
        error: 'Invalid message format. Expected: ' + expectedMessage,
        details: { reason: 'message_mismatch', expected: expectedMessage },
      };
    }

    // Check test signatures if configured
    if (
      this.config.acceptedTestSignatures &&
      this.config.acceptedTestSignatures.length > 0
    ) {
      if (this.config.acceptedTestSignatures.includes(payload.signature)) {
        logger.debug('Signature found in accepted test signatures list');
        return {
          valid: true,
          details: { verifier: 'mock', mode: 'accepted_test_signature' },
        };
      } else {
        logger.debug('Signature not in accepted test signatures list');
        return {
          valid: false,
          error: 'Invalid signature',
          details: { reason: 'signature_not_accepted' },
        };
      }
    }

    // Accept all valid if configured
    if (this.config.acceptAllValid) {
      logger.debug('Accepting payload (acceptAllValid=true)');
      return {
        valid: true,
        details: { verifier: 'mock', mode: 'accept_all_valid' },
      };
    }

    // Default: reject if no other rules matched
    return {
      valid: false,
      error: 'Verification failed',
      details: { reason: 'no_matching_rule' },
    };
  }
}

/**
 * Factory function to create a mock verifier with default config
 */
export function createMockVerifier(config?: MockVerifierConfig): MockRegistrationVerifier {
  return new MockRegistrationVerifier(config);
}

/**
 * Placeholder for future external verifier
 *
 * This would delegate verification to an external service:
 * - Intelligence Service
 * - Dedicated auth service
 * - Blockchain verification endpoint
 */
export class ExternalRegistrationVerifier implements RegistrationVerifier {
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    logger.info('ExternalRegistrationVerifier initialized', { endpoint });
  }

  async verify(
    payload: RegistrationPayload,
    context: VerificationContext
  ): Promise<VerificationResult> {
    // TODO: Implement external verification call
    // This would make an HTTP request to the verification endpoint
    logger.warn('ExternalRegistrationVerifier not yet implemented, rejecting');

    return {
      valid: false,
      error: 'External verification not yet implemented',
      details: {
        endpoint: this.endpoint,
        payload: { accountId: payload.accountId },
        context: { channel: context.channel, externalUserId: context.externalUserId },
      },
    };
  }
}
