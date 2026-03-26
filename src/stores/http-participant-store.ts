import type {
  ParticipantMapping,
  ParticipantLookupKey,
  ParticipantLookupResult,
  CreateParticipantMappingData,
} from '../types/index.js';
import type { ParticipantMappingStore } from '../services/participant-mapping-store.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('http-participant-store');

/**
 * HTTP-backed ParticipantMappingStore.
 *
 * Delegates storage to the intelligence service over HTTP.
 * Registrations persist as long as the intelligence service stays up —
 * no file system access, no database required.
 */
export class HttpParticipantMappingStore implements ParticipantMappingStore {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, '');
    logger.info('HttpParticipantMappingStore initialized', { baseUrl: this.baseUrl });
  }

  private deserializeMapping(raw: Record<string, unknown>): ParticipantMapping {
    return {
      ...(raw as any),
      createdAt: new Date(raw.createdAt as string),
      lastActiveAt: new Date(raw.lastActiveAt as string),
    };
  }

  async lookup(key: ParticipantLookupKey): Promise<ParticipantLookupResult> {
    const url = `${this.baseUrl}/v1/participants/lookup?channel=${encodeURIComponent(key.channel)}&externalUserId=${encodeURIComponent(key.externalUserId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Participant lookup failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json() as { found: boolean; mapping?: Record<string, unknown> };
    if (!body.found || !body.mapping) return { found: false };
    return { found: true, mapping: this.deserializeMapping(body.mapping) };
  }

  async create(data: CreateParticipantMappingData): Promise<ParticipantMapping> {
    const res = await fetch(`${this.baseUrl}/v1/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 409) {
      throw new Error(
        `Participant mapping already exists for channel=${data.channel}, externalUserId=${data.externalUserId}`
      );
    }
    if (!res.ok) {
      throw new Error(`Participant create failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json() as { mapping: Record<string, unknown> };
    return this.deserializeMapping(body.mapping);
  }

  async delete(key: ParticipantLookupKey): Promise<boolean> {
    const res = await fetch(
      `${this.baseUrl}/v1/participants/${encodeURIComponent(key.channel)}/${encodeURIComponent(key.externalUserId)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      throw new Error(`Participant delete failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json() as { deleted: boolean };
    return body.deleted;
  }

  async findByMoiAccountId(moiAccountId: string): Promise<ParticipantMapping[]> {
    // Not exposed via HTTP yet — return empty array as a safe fallback
    logger.warn('findByMoiAccountId is not supported by HttpParticipantMappingStore', { moiAccountId });
    return [];
  }
}
