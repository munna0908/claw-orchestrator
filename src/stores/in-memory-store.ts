import type {
  ParticipantMapping,
  ParticipantLookupKey,
  ParticipantLookupResult,
  CreateParticipantMappingData,
} from '../types/index.js';
import type { ParticipantMappingStore } from '../services/participant-mapping-store.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('in-memory-store');

/**
 * Generate a composite key for the mapping
 */
function generateKey(channel: string, externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}

/**
 * Generate a unique ID for new mappings
 */
function generateId(): string {
  return `pm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * In-memory implementation of ParticipantMappingStore
 *
 * This implementation stores participant mappings in memory.
 * Data is lost when the process restarts.
 *
 * Suitable for:
 * - Development and testing
 * - Phase 1 implementation
 *
 * Replace with SQLite/PostgreSQL implementation for production.
 */
export class InMemoryParticipantMappingStore implements ParticipantMappingStore {
  private mappings: Map<string, ParticipantMapping> = new Map();
  private moiAccountIndex: Map<string, Set<string>> = new Map();

  async lookup(key: ParticipantLookupKey): Promise<ParticipantLookupResult> {
    const compositeKey = generateKey(key.channel, key.externalUserId);
    const mapping = this.mappings.get(compositeKey);

    logger.debug('Participant lookup', {
      channel: key.channel,
      externalUserId: key.externalUserId,
      found: !!mapping,
    });

    if (mapping) {
      // Update last active timestamp
      mapping.lastActiveAt = new Date();
      return { found: true, mapping };
    }

    return { found: false };
  }

  async create(data: CreateParticipantMappingData): Promise<ParticipantMapping> {
    const compositeKey = generateKey(data.channel, data.externalUserId);

    // Check if mapping already exists
    if (this.mappings.has(compositeKey)) {
      throw new Error(
        `Participant mapping already exists for channel=${data.channel}, externalUserId=${data.externalUserId}`
      );
    }

    const now = new Date();
    const mapping: ParticipantMapping = {
      id: generateId(),
      channel: data.channel,
      externalUserId: data.externalUserId,
      moiAccountId: data.moiAccountId,
      createdAt: now,
      lastActiveAt: now,
    };

    this.mappings.set(compositeKey, mapping);

    // Update MOI account index
    let moiMappings = this.moiAccountIndex.get(data.moiAccountId);
    if (!moiMappings) {
      moiMappings = new Set();
      this.moiAccountIndex.set(data.moiAccountId, moiMappings);
    }
    moiMappings.add(compositeKey);

    logger.info('Created participant mapping', {
      id: mapping.id,
      channel: mapping.channel,
      externalUserId: mapping.externalUserId,
      moiAccountId: mapping.moiAccountId,
    });

    return mapping;
  }

  async delete(key: ParticipantLookupKey): Promise<boolean> {
    const compositeKey = generateKey(key.channel, key.externalUserId);
    const mapping = this.mappings.get(compositeKey);

    if (!mapping) {
      return false;
    }

    // Remove from MOI account index
    const moiMappings = this.moiAccountIndex.get(mapping.moiAccountId);
    if (moiMappings) {
      moiMappings.delete(compositeKey);
      if (moiMappings.size === 0) {
        this.moiAccountIndex.delete(mapping.moiAccountId);
      }
    }

    this.mappings.delete(compositeKey);

    logger.info('Deleted participant mapping', {
      id: mapping.id,
      channel: key.channel,
      externalUserId: key.externalUserId,
    });

    return true;
  }

  async findByMoiAccountId(moiAccountId: string): Promise<ParticipantMapping[]> {
    const keys = this.moiAccountIndex.get(moiAccountId);
    if (!keys) {
      return [];
    }

    const mappings: ParticipantMapping[] = [];
    for (const key of keys) {
      const mapping = this.mappings.get(key);
      if (mapping) {
        mappings.push(mapping);
      }
    }

    return mappings;
  }

  /**
   * Get total count of mappings (useful for monitoring)
   */
  getCount(): number {
    return this.mappings.size;
  }

  /**
   * Clear all mappings (useful for testing)
   */
  clear(): void {
    this.mappings.clear();
    this.moiAccountIndex.clear();
    logger.debug('Cleared all participant mappings');
  }
}

/**
 * Singleton instance
 */
let storeInstance: InMemoryParticipantMappingStore | null = null;

/**
 * Get the in-memory store instance (singleton)
 */
export function getInMemoryStore(): InMemoryParticipantMappingStore {
  if (!storeInstance) {
    storeInstance = new InMemoryParticipantMappingStore();
  }
  return storeInstance;
}

/**
 * Reset the store instance (useful for testing)
 */
export function resetInMemoryStore(): void {
  if (storeInstance) {
    storeInstance.clear();
  }
  storeInstance = null;
}
