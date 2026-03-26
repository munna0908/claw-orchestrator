import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type {
  ParticipantMapping,
  ParticipantLookupKey,
  ParticipantLookupResult,
  CreateParticipantMappingData,
} from '../types/index.js';
import type { ParticipantMappingStore } from '../services/participant-mapping-store.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('json-file-store');

function generateId(): string {
  return `pm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function compositeKey(channel: string, externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}

interface PersistedData {
  mappings: Record<string, ParticipantMapping>;
}

/**
 * JSON file-backed ParticipantMappingStore.
 * Persists registrations to disk so they survive process restarts.
 * Suitable for local development and single-node deployments.
 */
export class JsonFileParticipantMappingStore implements ParticipantMappingStore {
  private readonly filePath: string;
  private mappings: Map<string, ParticipantMapping>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.mappings = new Map();
    this.load();
    logger.info('JsonFileParticipantMappingStore initialized', { filePath });
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) {
        logger.debug('No existing store file — starting fresh', { filePath: this.filePath });
        return;
      }
      const raw = readFileSync(this.filePath, 'utf-8');
      const data: PersistedData = JSON.parse(raw);
      for (const [k, v] of Object.entries(data.mappings ?? {})) {
        // Rehydrate Date fields
        this.mappings.set(k, {
          ...v,
          createdAt: new Date(v.createdAt),
          lastActiveAt: new Date(v.lastActiveAt),
        });
      }
      logger.info('Loaded participant mappings from disk', { count: this.mappings.size });
    } catch (err) {
      logger.warn('Failed to load store file — starting fresh', { err: String(err) });
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data: PersistedData = { mappings: Object.fromEntries(this.mappings) };
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to persist store file: ${String(err)}`);
    }
  }

  async lookup(key: ParticipantLookupKey): Promise<ParticipantLookupResult> {
    const mapping = this.mappings.get(compositeKey(key.channel, key.externalUserId));
    if (mapping) {
      mapping.lastActiveAt = new Date();
      this.save();
      return { found: true, mapping };
    }
    return { found: false };
  }

  async create(data: CreateParticipantMappingData): Promise<ParticipantMapping> {
    const key = compositeKey(data.channel, data.externalUserId);
    if (this.mappings.has(key)) {
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
    this.mappings.set(key, mapping);
    this.save();
    logger.info('Created participant mapping', {
      id: mapping.id,
      channel: mapping.channel,
      externalUserId: mapping.externalUserId,
      moiAccountId: mapping.moiAccountId,
    });
    return mapping;
  }

  async delete(key: ParticipantLookupKey): Promise<boolean> {
    const k = compositeKey(key.channel, key.externalUserId);
    if (!this.mappings.has(k)) return false;
    this.mappings.delete(k);
    this.save();
    logger.info('Deleted participant mapping', { channel: key.channel, externalUserId: key.externalUserId });
    return true;
  }

  async findByMoiAccountId(moiAccountId: string): Promise<ParticipantMapping[]> {
    const results: ParticipantMapping[] = [];
    for (const mapping of this.mappings.values()) {
      if (mapping.moiAccountId === moiAccountId) results.push(mapping);
    }
    return results;
  }
}
