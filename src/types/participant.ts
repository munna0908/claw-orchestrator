import type { ChannelType } from './channel.js';

/**
 * Mapping between external channel user and MOI account
 */
export interface ParticipantMapping {
  /** Internal mapping identifier */
  id: string;

  /** Channel where participant is connected */
  channel: ChannelType;

  /** User identifier from the channel (e.g., Telegram user ID) */
  externalUserId: string;

  /** MOI account identifier */
  moiAccountId: string;

  /** When the mapping was created */
  createdAt: Date;

  /** Last time the participant was active */
  lastActiveAt: Date;
}

/**
 * Key for looking up participant mappings
 */
export interface ParticipantLookupKey {
  channel: ChannelType;
  externalUserId: string;
}

/**
 * Result of participant lookup
 */
export interface ParticipantLookupResult {
  found: boolean;
  mapping?: ParticipantMapping;
}

/**
 * Data required to create a new participant mapping
 */
export interface CreateParticipantMappingData {
  channel: ChannelType;
  externalUserId: string;
  moiAccountId: string;
}
