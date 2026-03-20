import type { ParticipantLookupKey, ParticipantLookupResult } from '../types/index.js';
import type { ParticipantMappingStore } from './participant-mapping-store.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('registration-checker');

/**
 * Result of a registration check
 */
export interface RegistrationCheckResult {
  /** Whether the participant is registered */
  isRegistered: boolean;

  /** MOI account ID if registered */
  moiAccountId?: string;

  /** Participant mapping ID if registered */
  mappingId?: string;
}

/**
 * RegistrationChecker service
 *
 * Checks if a participant (identified by channel + external user ID)
 * is registered with a MOI account.
 *
 * This is a thin wrapper around the participant mapping store.
 * Future phases may add:
 * - Caching
 * - Account status verification with external service
 * - Permission checks
 */
export class RegistrationChecker {
  constructor(private readonly store: ParticipantMappingStore) {}

  /**
   * Check if a participant is registered
   */
  async check(key: ParticipantLookupKey): Promise<RegistrationCheckResult> {
    logger.debug('Checking registration', {
      channel: key.channel,
      externalUserId: key.externalUserId,
    });

    const result: ParticipantLookupResult = await this.store.lookup(key);

    if (!result.found || !result.mapping) {
      logger.debug('Participant not registered', {
        channel: key.channel,
        externalUserId: key.externalUserId,
      });

      return { isRegistered: false };
    }

    logger.debug('Participant is registered', {
      channel: key.channel,
      externalUserId: key.externalUserId,
      moiAccountId: result.mapping.moiAccountId,
      mappingId: result.mapping.id,
    });

    return {
      isRegistered: true,
      moiAccountId: result.mapping.moiAccountId,
      mappingId: result.mapping.id,
    };
  }
}

/**
 * Factory function to create a RegistrationChecker
 */
export function createRegistrationChecker(store: ParticipantMappingStore): RegistrationChecker {
  return new RegistrationChecker(store);
}
