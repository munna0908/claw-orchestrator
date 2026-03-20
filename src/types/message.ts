import type { ChannelType, ChannelMeta } from './channel.js';

/**
 * Inbound message from OpenClaw channel
 */
export interface InboundMessage {
  /** Unique message identifier from the channel */
  messageId: string;

  /** Channel that received the message */
  channel: ChannelType;

  /** Channel-specific metadata */
  channelMeta: ChannelMeta;

  /** External user identifier from the channel */
  externalUserId: string;

  /** Display name of the sender (if available) */
  senderName?: string | undefined;

  /** Raw text content of the message */
  text: string;

  /** Timestamp when message was received */
  timestamp: Date;
}

/**
 * Outbound reply to be sent via OpenClaw
 */
export interface OutboundReply {
  /** Channel to send the reply to */
  channel: ChannelType;

  /** Channel-specific metadata for reply routing */
  channelMeta: ChannelMeta;

  /** External user identifier to reply to */
  externalUserId: string;

  /** Reply text content */
  text: string;

  /** Optional: Reply to specific message */
  replyToMessageId?: string | undefined;
}

/**
 * Result of processing an inbound message
 */
export interface MessageProcessingResult {
  success: boolean;
  messageId: string;
  action: 'registration_required' | 'workflow_continue' | 'error';
  error?: string | undefined;
}
