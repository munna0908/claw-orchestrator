import type { InboundMessage } from '../types/index.js';
import type { WorkflowHandler, ExtendedMessageProcessingResult } from '../handlers/workflow-handler.js';
import { createLogger } from '../logger/index.js';
import { getConfig } from '../config/index.js';
import { ChannelType } from '../types/index.js';

const logger = createLogger('message-router');

/**
 * MessageRouter service
 *
 * Routes inbound messages to the appropriate handler.
 * This is the entry point for all inbound messages from OpenClaw.
 *
 * Responsibilities:
 * - Validate inbound messages
 * - Check if channel is enabled
 * - Route to workflow handler
 */
export class MessageRouter {
  constructor(private readonly workflowHandler: WorkflowHandler) {}

  /**
   * Check if a channel is enabled in configuration
   */
  private isChannelEnabled(channel: string): boolean {
    const config = getConfig();

    switch (channel) {
      case ChannelType.TELEGRAM:
        return config.channels.telegram;
      case ChannelType.WHATSAPP:
        return config.channels.whatsapp;
      default:
        return false;
    }
  }

  /**
   * Validate an inbound message
   */
  private validateMessage(message: InboundMessage): string | null {
    if (!message.messageId) {
      return 'Missing messageId';
    }

    if (!message.channel) {
      return 'Missing channel';
    }

    if (!message.externalUserId) {
      return 'Missing externalUserId';
    }

    if (message.text === undefined || message.text === null) {
      return 'Missing text';
    }

    return null;
  }

  /**
   * Route an inbound message
   */
  async route(message: InboundMessage): Promise<ExtendedMessageProcessingResult> {
    logger.debug('Routing inbound message', {
      messageId: message.messageId,
      channel: message.channel,
      externalUserId: message.externalUserId,
      textLength: message.text?.length ?? 0,
    });

    // Validate message
    const validationError = this.validateMessage(message);
    if (validationError) {
      logger.warn('Invalid message received', {
        messageId: message.messageId,
        error: validationError,
      });

      return {
        success: false,
        messageId: message.messageId,
        action: 'error',
        error: validationError,
      };
    }

    // Check if channel is enabled
    if (!this.isChannelEnabled(message.channel)) {
      logger.warn('Message from disabled channel', {
        messageId: message.messageId,
        channel: message.channel,
      });

      return {
        success: false,
        messageId: message.messageId,
        action: 'error',
        error: `Channel ${message.channel} is not enabled`,
      };
    }

    // Route to workflow handler
    try {
      const result = await this.workflowHandler.handle(message);

      logger.info('Message processed', {
        messageId: message.messageId,
        action: result.action,
        success: result.success,
      });

      return result;
    } catch (error) {
      logger.error('Error processing message', error as Error, {
        messageId: message.messageId,
        channel: message.channel,
      });

      return {
        success: false,
        messageId: message.messageId,
        action: 'error',
        error: (error as Error).message,
      };
    }
  }
}

/**
 * Factory function to create MessageRouter
 */
export function createMessageRouter(workflowHandler: WorkflowHandler): MessageRouter {
  return new MessageRouter(workflowHandler);
}
