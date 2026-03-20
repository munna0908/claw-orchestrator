import type {
  ParticipantMapping,
  ParticipantLookupKey,
  ParticipantLookupResult,
  CreateParticipantMappingData,
} from '../types/index.js';

/**
 * Abstract interface for participant mapping storage
 *
 * This interface allows swapping storage implementations:
 * - InMemoryParticipantMappingStore (v1, development)
 * - SQLiteParticipantMappingStore (v2, single-node production)
 * - PostgresParticipantMappingStore (v3, distributed production)
 */
export interface ParticipantMappingStore {
  /**
   * Look up a participant mapping by channel and external user ID
   */
  lookup(key: ParticipantLookupKey): Promise<ParticipantLookupResult>;

  /**
   * Create a new participant mapping
   * @throws Error if mapping already exists
   */
  create(data: CreateParticipantMappingData): Promise<ParticipantMapping>;

  /**
   * Delete a participant mapping
   * @returns true if mapping was deleted, false if not found
   */
  delete(key: ParticipantLookupKey): Promise<boolean>;

  /**
   * Find all mappings for a MOI account
   * Useful for account management
   */
  findByMoiAccountId(moiAccountId: string): Promise<ParticipantMapping[]>;
}

/**
 * Store factory type for dependency injection
 */
export type ParticipantMappingStoreFactory = () => ParticipantMappingStore;
