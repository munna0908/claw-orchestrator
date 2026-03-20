import type {
  RegistrationPayload,
  VerificationContext,
  RegistrationResult,
} from '../types/registration.js';
import type { ParticipantMappingStore } from './participant-mapping-store.js';
import type { RegistrationVerifier } from './registration-verifier.js';
import { parseRegistrationCommand, isRegistrationCommand } from './registration-parser.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('registration-service');

/**
 * Registration Service
 *
 * Orchestrates the full registration flow:
 * 1. Parse the registration command
 * 2. Check if already registered
 * 3. Verify the registration payload
 * 4. Store the participant mapping
 *
 * This service coordinates between:
 * - Registration parser (command parsing)
 * - Registration verifier (signature validation)
 * - Participant mapping store (persistence)
 */
export class RegistrationService {
  constructor(
    private readonly verifier: RegistrationVerifier,
    private readonly store: ParticipantMappingStore
  ) {}

  /**
   * Check if a message is a registration command
   */
  isRegistrationCommand(text: string): boolean {
    return isRegistrationCommand(text);
  }

  /**
   * Process a registration command
   *
   * @param text - The raw message text (e.g., "/register {...}")
   * @param context - Verification context (channel, user info)
   * @returns Registration result
   */
  async processRegistration(
    text: string,
    context: VerificationContext
  ): Promise<RegistrationResult> {
    logger.info('Processing registration', {
      channel: context.channel,
      externalUserId: context.externalUserId,
    });

    // Step 1: Check if already registered
    const existingMapping = await this.store.lookup({
      channel: context.channel,
      externalUserId: context.externalUserId,
    });

    if (existingMapping.found && existingMapping.mapping) {
      logger.info('User is already registered', {
        channel: context.channel,
        externalUserId: context.externalUserId,
        moiAccountId: existingMapping.mapping.moiAccountId,
      });

      return {
        success: false,
        action: 'already_registered',
        moiAccountId: existingMapping.mapping.moiAccountId,
        error: `You are already registered with MOI account: ${existingMapping.mapping.moiAccountId}`,
      };
    }

    // Step 2: Parse the registration command
    const parseResult = parseRegistrationCommand(text);

    if (!parseResult.success || !parseResult.payload) {
      logger.debug('Failed to parse registration command', {
        error: parseResult.error,
        errorField: parseResult.errorField,
      });

      return {
        success: false,
        action: 'invalid_payload',
        error: parseResult.error ?? 'Invalid registration payload',
      };
    }

    const payload: RegistrationPayload = parseResult.payload;

    // Step 3: Verify the registration payload
    const verificationResult = await this.verifier.verify(payload, context);

    if (!verificationResult.valid) {
      logger.info('Registration verification failed', {
        channel: context.channel,
        externalUserId: context.externalUserId,
        accountId: payload.accountId,
        error: verificationResult.error,
      });

      return {
        success: false,
        action: 'verification_failed',
        error: verificationResult.error ?? 'Signature verification failed',
      };
    }

    // Step 4: Store the participant mapping
    try {
      const mapping = await this.store.create({
        channel: context.channel,
        externalUserId: context.externalUserId,
        moiAccountId: payload.accountId,
      });

      logger.info('Registration successful', {
        mappingId: mapping.id,
        channel: context.channel,
        externalUserId: context.externalUserId,
        moiAccountId: payload.accountId,
      });

      return {
        success: true,
        action: 'registered',
        moiAccountId: payload.accountId,
      };
    } catch (error) {
      logger.error('Failed to store participant mapping', error as Error, {
        channel: context.channel,
        externalUserId: context.externalUserId,
        accountId: payload.accountId,
      });

      return {
        success: false,
        action: 'error',
        error: 'Failed to complete registration. Please try again.',
      };
    }
  }

  /**
   * Validate a registration payload without storing
   * Useful for pre-validation or testing
   */
  async validatePayload(
    payload: RegistrationPayload,
    context: VerificationContext
  ): Promise<{ valid: boolean; error?: string }> {
    const verificationResult = await this.verifier.verify(payload, context);

    if (verificationResult.error) {
      return {
        valid: verificationResult.valid,
        error: verificationResult.error,
      };
    }

    return {
      valid: verificationResult.valid,
    };
  }
}

/**
 * Factory function to create a RegistrationService
 */
export function createRegistrationService(
  verifier: RegistrationVerifier,
  store: ParticipantMappingStore
): RegistrationService {
  return new RegistrationService(verifier, store);
}
