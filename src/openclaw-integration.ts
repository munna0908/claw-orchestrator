/**
 * OpenClaw Plugin Integration
 *
 * This module provides the integration layer between OpenClaw's plugin system
 * and the participant-orchestrator plugin.
 *
 * OpenClaw plugins can export either:
 * - A function: (api) => { ... }
 * - An object: { id, name, configSchema, register(api) { ... } }
 *
 * We use the object form for better type safety and explicit structure.
 */

import type {
  InboundMessage,
  ChannelType,
  TelegramChannelMeta,
  WhatsAppChannelMeta,
} from './types/index.js';
import { ChannelType as ChannelTypeEnum } from './types/index.js';
import { createPlugin, type ParticipantOrchestratorPlugin } from './index.js';
import { createLogger } from './logger/index.js';

const logger = createLogger('openclaw-integration');

/**
 * OpenClaw Plugin API interface
 * Based on OpenClaw plugin SDK documentation
 */
interface OpenClawPluginApi {
  /** Register lifecycle event handlers */
  on(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;

  /** Register a channel extension */
  registerChannel(config: ChannelExtensionConfig): void;

  /** Register a tool */
  registerTool(tool: ToolDefinition): void;

  /** Register an HTTP route */
  registerHttpRoute(route: HttpRouteConfig): void;

  /** Access runtime services */
  runtime: {
    config: Record<string, unknown>;
    logger: unknown;
  };

  /** Plugin configuration */
  config: PluginConfig;
}

interface ChannelExtensionConfig {
  /** Channel IDs this extension handles */
  channels: ChannelType[];

  /** Hook into inbound message processing */
  onInbound?: (context: OpenClawInboundContext) => Promise<InboundHookResult>;

  /** Hook into outbound message processing */
  onOutbound?: (context: OpenClawOutboundContext) => Promise<void>;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

interface HttpRouteConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: unknown, res: unknown) => Promise<void>;
}

interface PluginConfig {
  enableTelegram?: boolean;
  enableWhatsApp?: boolean;
}

/**
 * OpenClaw Inbound Context
 * Normalized message format from any channel
 */
export interface OpenClawInboundContext {
  /** Unique message identifier */
  messageId: string;

  /** Source channel */
  channel: 'telegram' | 'whatsapp' | 'discord' | 'slack' | 'signal';

  /** Session key for routing */
  sessionKey: string;

  /** User identifier from the channel */
  userId: string;

  /** Display name of sender */
  displayName?: string;

  /** Message content */
  text: string;

  /** Timestamp */
  timestamp: Date;

  /** Platform-specific metadata */
  platform: {
    telegram?: {
      chatId: number;
      chatType: 'private' | 'group' | 'supergroup' | 'channel';
      messageId: number;
    };
    whatsapp?: {
      phoneNumber: string;
      messageId: string;
      fromMe: boolean;
    };
  };

  /** Media attachments */
  media?: {
    type: 'image' | 'video' | 'audio' | 'document';
    url: string;
    mimeType: string;
  }[];

  /** Reply function to send response */
  reply: (text: string, options?: ReplyOptions) => Promise<void>;

  /** Send typing indicator */
  sendTyping: () => Promise<void>;
}

interface ReplyOptions {
  /** Reply to specific message */
  replyToMessageId?: string;

  /** Media to attach */
  media?: {
    type: 'image' | 'video' | 'audio' | 'document';
    url: string;
  };
}

interface OpenClawOutboundContext {
  channel: string;
  userId: string;
  text: string;
  sessionKey: string;
}

/**
 * Result of inbound hook processing
 */
interface InboundHookResult {
  /** Whether to continue to default processing */
  continueProcessing: boolean;

  /** Whether we handled the message */
  handled: boolean;

  /** Optional modified context */
  modifiedContext?: Partial<OpenClawInboundContext>;
}

/**
 * OpenClaw Reply Sender implementation
 * Bridges OpenClaw's reply mechanism to our plugin
 */
class OpenClawReplySender {
  private replyFn: ((text: string, options?: ReplyOptions) => Promise<void>) | null = null;

  setReplyFunction(fn: (text: string, options?: ReplyOptions) => Promise<void>): void {
    this.replyFn = fn;
  }

  async send(reply: { text: string; replyToMessageId?: string }): Promise<void> {
    if (!this.replyFn) {
      logger.warn('Reply function not set, cannot send reply');
      return;
    }

    await this.replyFn(
      reply.text,
      reply.replyToMessageId ? { replyToMessageId: reply.replyToMessageId } : undefined
    );
  }
}

/**
 * Convert OpenClaw channel to our ChannelType
 */
function mapChannel(channel: string): ChannelType {
  switch (channel) {
    case 'telegram':
      return ChannelTypeEnum.TELEGRAM;
    case 'whatsapp':
      return ChannelTypeEnum.WHATSAPP;
    default:
      return channel as ChannelType;
  }
}

/**
 * Convert OpenClaw context to our InboundMessage format
 */
function convertToInboundMessage(context: OpenClawInboundContext): InboundMessage {
  const channel = mapChannel(context.channel);

  let channelMeta: TelegramChannelMeta | WhatsAppChannelMeta;

  if (context.channel === 'telegram' && context.platform.telegram) {
    channelMeta = {
      chatId: context.platform.telegram.chatId,
      chatType: context.platform.telegram.chatType,
      messageId: context.platform.telegram.messageId,
    };
  } else if (context.channel === 'whatsapp' && context.platform.whatsapp) {
    channelMeta = {
      phoneNumber: context.platform.whatsapp.phoneNumber,
      messageId: context.platform.whatsapp.messageId,
    };
  } else {
    // Fallback for unknown channels
    channelMeta = {
      chatId: 0,
      chatType: 'private',
      messageId: 0,
    } as TelegramChannelMeta;
  }

  return {
    messageId: context.messageId,
    channel,
    channelMeta,
    externalUserId: context.userId,
    senderName: context.displayName,
    text: context.text,
    timestamp: context.timestamp,
  };
}

/**
 * Create the OpenClaw plugin definition
 */
function createOpenClawPlugin() {
  let plugin: ParticipantOrchestratorPlugin | null = null;
  const replySender = new OpenClawReplySender();

  return {
    id: 'participant-orchestrator',
    name: 'Participant Orchestrator',

    /**
     * Plugin registration function
     * Called by OpenClaw when loading the plugin
     */
    register(api: OpenClawPluginApi): void {
      logger.info('Registering participant-orchestrator with OpenClaw');

      // Initialize our plugin with OpenClaw's reply sender
      plugin = createPlugin({
        replySender: {
          send: async (reply) => {
            await replySender.send(
              reply.replyToMessageId
                ? { text: reply.text, replyToMessageId: reply.replyToMessageId }
                : { text: reply.text }
            );
          },
        },
      });

      // Get enabled channels from config
      const enableTelegram = api.config.enableTelegram ?? true;
      const enableWhatsApp = api.config.enableWhatsApp ?? false;

      const enabledChannels: ChannelType[] = [];
      if (enableTelegram) enabledChannels.push('telegram');
      if (enableWhatsApp) enabledChannels.push('whatsapp');

      logger.info('Enabled channels', { channels: enabledChannels });

      // Register as channel extension to intercept inbound messages
      api.registerChannel({
        channels: enabledChannels,

        /**
         * Inbound message hook
         * Called before OpenClaw's default agent processing
         */
        onInbound: async (context: OpenClawInboundContext): Promise<InboundHookResult> => {
          logger.debug('Received inbound message', {
            channel: context.channel,
            userId: context.userId,
            messageId: context.messageId,
          });

          // Show typing indicator while processing
          await context.sendTyping();

          // Set the reply function for this context
          replySender.setReplyFunction(context.reply);

          // Convert to our message format
          const message = convertToInboundMessage(context);

          // Process through our plugin
          const result = await plugin!.handleMessage(message);

          logger.info('Message processed', {
            messageId: result.messageId,
            action: result.action,
            success: result.success,
          });

          // For Phase 1, we handle registration check ourselves
          // and don't pass to OpenClaw's default agent
          if (result.action === 'registration_required') {
            return {
              continueProcessing: false,
              handled: true,
            };
          }

          // For registered users in Phase 1, we send placeholder
          // In Phase 2+, this would continue to agent processing
          if (result.action === 'workflow_continue') {
            // For now, we handle it ourselves with placeholder
            // Later phases will return continueProcessing: true
            // to let OpenClaw's agent handle the conversation
            return {
              continueProcessing: false,
              handled: true,
            };
          }

          // On error, let OpenClaw handle it
          return {
            continueProcessing: true,
            handled: false,
          };
        },
      });

      // Register health check HTTP route
      api.registerHttpRoute({
        method: 'GET',
        path: '/plugins/participant-orchestrator/health',
        handler: async (_req, res) => {
          const health = await plugin!.healthCheck();
          (res as { json: (data: unknown) => void }).json(health);
        },
      });

      // Register tool for manual registration (Phase 2 preview)
      api.registerTool({
        name: 'register_participant',
        description: 'Register a participant mapping between channel user and MOI account',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              enum: ['telegram', 'whatsapp'],
              description: 'The messaging channel',
            },
            externalUserId: {
              type: 'string',
              description: 'User ID from the channel',
            },
            moiAccountId: {
              type: 'string',
              description: 'MOI account identifier',
            },
          },
          required: ['channel', 'externalUserId', 'moiAccountId'],
        },
        execute: async (params) => {
          const store = plugin!.getParticipantStore();
          const mapping = await store.create({
            channel: params['channel'] as ChannelType,
            externalUserId: params['externalUserId'] as string,
            moiAccountId: params['moiAccountId'] as string,
          });
          return { success: true, mappingId: mapping.id };
        },
      });

      // Listen for plugin lifecycle events
      api.on('shutdown', async () => {
        logger.info('Plugin shutdown requested');
        // Cleanup if needed
      });

      logger.info('Plugin registration complete');
    },
  };
}

/**
 * Export the plugin definition
 * OpenClaw will import this and call register(api)
 */
export const openclawPlugin = createOpenClawPlugin();

/**
 * Default export for OpenClaw plugin loader
 */
export default openclawPlugin;
