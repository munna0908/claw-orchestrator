import type {
  WorkflowRecord,
  CreateWorkflowInput,
  UpdateWorkflowInput,
} from '../types/workflow.js';
import { WorkflowStatus } from '../types/workflow.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('workflow-store');

/**
 * Generate a unique workflow ID
 */
function generateWorkflowId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `wf_${timestamp}_${random}`;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `req_${timestamp}_${random}`;
}

/**
 * Workflow Store Interface
 *
 * Stores workflow state for session orchestration.
 */
export interface WorkflowStore {
  /**
   * Create a new workflow
   */
  create(input: CreateWorkflowInput): Promise<WorkflowRecord>;

  /**
   * Get a workflow by ID
   */
  get(workflowId: string): Promise<WorkflowRecord | null>;

  /**
   * Update a workflow
   */
  update(workflowId: string, input: UpdateWorkflowInput): Promise<WorkflowRecord | null>;

  /**
   * Find workflows by participant ID
   */
  findByParticipant(participantId: string): Promise<WorkflowRecord[]>;

  /**
   * Find workflows by status
   */
  findByStatus(status: WorkflowStatus): Promise<WorkflowRecord[]>;

  /**
   * Find the latest active workflow for a participant
   */
  findLatestActive(participantId: string): Promise<WorkflowRecord | null>;

  /**
   * Delete a workflow
   */
  delete(workflowId: string): Promise<boolean>;

  /**
   * Delete all workflows for a participant. Returns the number deleted.
   */
  clearByParticipant(participantId: string): Promise<number>;

  /**
   * Get count of workflows
   */
  getCount(): Promise<number>;
}

/**
 * In-Memory Workflow Store
 *
 * Stores workflow records in memory.
 * For v1 development and testing.
 */
export class InMemoryWorkflowStore implements WorkflowStore {
  private records: Map<string, WorkflowRecord> = new Map();

  async create(input: CreateWorkflowInput): Promise<WorkflowRecord> {
    const workflowId = generateWorkflowId();
    const requestId = generateRequestId();
    const now = new Date();

    const record: WorkflowRecord = {
      workflowId,
      requestId,
      participantId: input.participantId,
      channel: input.channel,
      externalUserId: input.externalUserId,
      originalMessage: input.originalMessage,
      intent: input.intent,
      requiredCategories: input.requiredCategories,
      requiredScopes: input.requiredScopes,
      status: WorkflowStatus.NEW,
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(workflowId, record);

    logger.info('Created workflow', {
      workflowId,
      requestId,
      participantId: input.participantId,
      intent: input.intent,
      status: record.status,
    });

    return record;
  }

  async get(workflowId: string): Promise<WorkflowRecord | null> {
    const record = this.records.get(workflowId);

    if (!record) {
      logger.debug('Workflow not found', { workflowId });
      return null;
    }

    return record;
  }

  async update(
    workflowId: string,
    input: UpdateWorkflowInput
  ): Promise<WorkflowRecord | null> {
    const record = this.records.get(workflowId);

    if (!record) {
      logger.warn('Cannot update non-existent workflow', { workflowId });
      return null;
    }

    const previousStatus = record.status;

    if (input.status !== undefined) {
      record.status = input.status;
    }
    if (input.sessionId !== undefined) {
      record.sessionId = input.sessionId;
    }
    if (input.txHash !== undefined) {
      record.txHash = input.txHash;
    }
    if (input.signingPayload !== undefined) {
      record.signingPayload = input.signingPayload;
    }

    record.updatedAt = new Date();

    logger.info('Updated workflow', {
      workflowId,
      previousStatus,
      newStatus: record.status,
      sessionId: record.sessionId,
      txHash: record.txHash,
    });

    return record;
  }

  async findByParticipant(participantId: string): Promise<WorkflowRecord[]> {
    const results: WorkflowRecord[] = [];

    for (const record of this.records.values()) {
      if (record.participantId === participantId) {
        results.push(record);
      }
    }

    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findByStatus(status: WorkflowStatus): Promise<WorkflowRecord[]> {
    const results: WorkflowRecord[] = [];

    for (const record of this.records.values()) {
      if (record.status === status) {
        results.push(record);
      }
    }

    return results;
  }

  async findLatestActive(participantId: string): Promise<WorkflowRecord | null> {
    const participantWorkflows = await this.findByParticipant(participantId);

    // Find the most recent non-terminal workflow
    const terminalStatuses: WorkflowStatus[] = [
      WorkflowStatus.FAILED,
      WorkflowStatus.READY_FOR_INFERENCE,
    ];

    for (const workflow of participantWorkflows) {
      if (!terminalStatuses.includes(workflow.status)) {
        return workflow;
      }
    }

    return null;
  }

  async delete(workflowId: string): Promise<boolean> {
    const existed = this.records.has(workflowId);
    this.records.delete(workflowId);

    if (existed) {
      logger.info('Deleted workflow', { workflowId });
    }

    return existed;
  }

  async clearByParticipant(participantId: string): Promise<number> {
    let count = 0;
    for (const [workflowId, record] of this.records) {
      if (record.participantId === participantId) {
        this.records.delete(workflowId);
        count++;
      }
    }
    if (count > 0) {
      logger.info('Cleared workflows for participant', { participantId, count });
    }
    return count;
  }

  async getCount(): Promise<number> {
    return this.records.size;
  }

  /**
   * Clear all records (for testing)
   */
  clear(): void {
    this.records.clear();
    logger.debug('Cleared all workflow records');
  }
}

/**
 * Singleton instance for the in-memory workflow store
 */
let workflowStoreInstance: InMemoryWorkflowStore | null = null;

/**
 * Get the singleton workflow store instance
 */
export function getWorkflowStore(): InMemoryWorkflowStore {
  if (!workflowStoreInstance) {
    workflowStoreInstance = new InMemoryWorkflowStore();
  }
  return workflowStoreInstance;
}

/**
 * Reset the workflow store (for testing)
 */
export function resetWorkflowStore(): void {
  if (workflowStoreInstance) {
    workflowStoreInstance.clear();
  }
  workflowStoreInstance = null;
}

/**
 * Factory function to create a workflow store
 */
export function createWorkflowStore(): InMemoryWorkflowStore {
  return new InMemoryWorkflowStore();
}
