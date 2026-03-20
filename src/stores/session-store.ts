import type { SessionRecord } from '../types/session.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('session-store');

/**
 * Session Store Interface
 *
 * Stores known session IDs for each participant.
 * This is a local cache - session validity must always be checked
 * via the Intelligence Service.
 */
export interface SessionStore {
  /**
   * Get all known session IDs for a participant
   */
  getSessionIds(participantId: string): Promise<string[]>;

  /**
   * Add a session ID to a participant's known sessions
   */
  addSessionId(participantId: string, sessionId: string): Promise<void>;

  /**
   * Remove a session ID from a participant's known sessions
   */
  removeSessionId(participantId: string, sessionId: string): Promise<void>;

  /**
   * Get full session record for a participant
   */
  getRecord(participantId: string): Promise<SessionRecord | null>;

  /**
   * Clear all sessions for a participant
   */
  clearSessions(participantId: string): Promise<void>;

  /**
   * Get count of participants with sessions
   */
  getParticipantCount(): Promise<number>;
}

/**
 * In-Memory Session Store
 *
 * Stores participant session IDs in memory.
 * For v1 development and testing.
 */
export class InMemorySessionStore implements SessionStore {
  private records: Map<string, SessionRecord> = new Map();

  async getSessionIds(participantId: string): Promise<string[]> {
    const record = this.records.get(participantId);

    if (!record) {
      logger.debug('No session record found for participant', { participantId });
      return [];
    }

    logger.debug('Found session IDs for participant', {
      participantId,
      sessionCount: record.sessionIds.length,
    });

    return [...record.sessionIds];
  }

  async addSessionId(participantId: string, sessionId: string): Promise<void> {
    let record = this.records.get(participantId);

    if (!record) {
      record = {
        participantId,
        sessionIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.records.set(participantId, record);
    }

    if (!record.sessionIds.includes(sessionId)) {
      record.sessionIds.push(sessionId);
      record.updatedAt = new Date();

      logger.info('Added session ID for participant', {
        participantId,
        sessionId,
        totalSessions: record.sessionIds.length,
      });
    } else {
      logger.debug('Session ID already exists for participant', {
        participantId,
        sessionId,
      });
    }
  }

  async removeSessionId(participantId: string, sessionId: string): Promise<void> {
    const record = this.records.get(participantId);

    if (!record) {
      logger.debug('No session record found to remove from', { participantId });
      return;
    }

    const index = record.sessionIds.indexOf(sessionId);
    if (index !== -1) {
      record.sessionIds.splice(index, 1);
      record.updatedAt = new Date();

      logger.info('Removed session ID for participant', {
        participantId,
        sessionId,
        remainingSessions: record.sessionIds.length,
      });
    }
  }

  async getRecord(participantId: string): Promise<SessionRecord | null> {
    return this.records.get(participantId) ?? null;
  }

  async clearSessions(participantId: string): Promise<void> {
    this.records.delete(participantId);
    logger.info('Cleared all sessions for participant', { participantId });
  }

  async getParticipantCount(): Promise<number> {
    return this.records.size;
  }

  /**
   * Clear all records (for testing)
   */
  clear(): void {
    this.records.clear();
    logger.debug('Cleared all session records');
  }
}

/**
 * Singleton instance for the in-memory session store
 */
let sessionStoreInstance: InMemorySessionStore | null = null;

/**
 * Get the singleton session store instance
 */
export function getSessionStore(): InMemorySessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new InMemorySessionStore();
  }
  return sessionStoreInstance;
}

/**
 * Reset the session store (for testing)
 */
export function resetSessionStore(): void {
  if (sessionStoreInstance) {
    sessionStoreInstance.clear();
  }
  sessionStoreInstance = null;
}

/**
 * Factory function to create a session store
 */
export function createSessionStore(): InMemorySessionStore {
  return new InMemorySessionStore();
}
