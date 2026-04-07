import type { OutboundReply, ChannelType, ChannelMeta } from '../types/index.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('reply-service');

/**
 * Reply sender interface
 *
 * This interface abstracts the actual sending mechanism.
 * In production, this would be implemented by OpenClaw SDK.
 */
export interface ReplySender {
  send(reply: OutboundReply): Promise<void>;
}

/**
 * Standard reply messages
 */
export const ReplyMessages = {
  REGISTRATION_REQUIRED:
    'You are not registered yet. Please register your MOI account.\n\n' +
    'Send a registration command in this format:\n' +
    '/register {"accountId":"your_moi_id","publicKey":"your_public_key","signature":"your_signature","message":"register:channel_userid"}',

  WORKFLOW_CONTINUE:
    'Registered user detected. Workflow orchestration will continue.',

  INTERNAL_ERROR:
    'Sorry, something went wrong. Please try again later.',

  REGISTRATION_SUCCESS:
    '🎉 *You\'re all set!*\n\nYour MOI Wallet has been verified and linked to your assistant. Your identity is secured on the MOI network — only you control your data.\n\n💬 Now just say *"order food"* to get started!',

  REGISTRATION_FAILED:
    'Registration failed. Please check your payload and try again.',

  ALREADY_REGISTERED:
    '✅ *Welcome back!*\n\nYour wallet is already linked. Just say *"order food"* whenever you\'re ready.',

  SESSION_CREATION_REQUIRED:
    'Session approval required.',

  SESSION_RESUMED:
    'Session is active. Continuing workflow.',

  SESSION_PENDING:
    'Your session transaction is still pending.',

  SESSION_FAILED:
    'Session approval failed.',

  UNKNOWN_INTENT:
    'I could not understand your request. Please try again with a clearer message.',

  RESUME_ERROR:
    'Could not resume workflow.',

} as const;

/**
 * Truncate a MOI account ID to show only significant hex digits,
 * skipping leading/trailing zeros: e.g. 0x1a2b...3c4d
 */
function truncateMoiId(moiAccountId: string): string {
  const hex = moiAccountId.startsWith('0x') ? moiAccountId.slice(2) : moiAccountId;
  const firstNonZero = hex.search(/[^0]/);
  const lastNonZero = hex.length - 1 - [...hex].reverse().join('').search(/[^0]/);
  const significant = firstNonZero === -1 ? '0000' : hex.slice(firstNonZero, lastNonZero + 1);
  return `0x${significant.slice(0, 4)}...${significant.slice(-4)}`;
}

/**
 * ReplyService handles sending replies back to users
 *
 * This service:
 * - Builds outbound reply objects
 * - Delegates sending to the configured sender (OpenClaw)
 * - Handles standard reply messages
 */
export class ReplyService {
  constructor(private readonly sender: ReplySender) {}

  /**
   * Build an outbound reply
   */
  private buildReply(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    text: string,
    replyToMessageId?: string
  ): OutboundReply {
    return {
      channel,
      channelMeta,
      externalUserId,
      text,
      replyToMessageId,
    };
  }

  /**
   * Send a reply to the user
   */
  async sendReply(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    text: string,
    replyToMessageId?: string
  ): Promise<void> {
    const reply = this.buildReply(channel, channelMeta, externalUserId, text, replyToMessageId);

    logger.debug('Sending reply', {
      channel,
      externalUserId,
      textLength: text.length,
      hasReplyTo: !!replyToMessageId,
    });

    try {
      await this.sender.send(reply);

      logger.info('Reply sent', {
        channel,
        externalUserId,
      });
    } catch (error) {
      logger.error('Failed to send reply', error as Error, {
        channel,
        externalUserId,
      });
      throw error;
    }
  }

  /**
   * Send registration required message
   */
  async sendRegistrationRequired(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    replyToMessageId?: string
  ): Promise<void> {
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      ReplyMessages.REGISTRATION_REQUIRED,
      replyToMessageId
    );
  }

  /**
   * Send workflow continue message (placeholder for Phase 1)
   */
  async sendWorkflowContinue(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    replyToMessageId?: string
  ): Promise<void> {
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      ReplyMessages.WORKFLOW_CONTINUE,
      replyToMessageId
    );
  }

  /**
   * Send internal error message
   */
  async sendInternalError(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    replyToMessageId?: string
  ): Promise<void> {
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      ReplyMessages.INTERNAL_ERROR,
      replyToMessageId
    );
  }

  /**
   * Send registration success message
   */
  async sendRegistrationSuccess(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    moiAccountId: string,
    replyToMessageId?: string
  ): Promise<void> {
    const trustClawId = truncateMoiId(moiAccountId);
    const message = `${ReplyMessages.REGISTRATION_SUCCESS}\n\n━━━━━━━━━━━━━━━\n\nTrustClaw ID: ${trustClawId}`;
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      message,
      replyToMessageId
    );
  }

  /**
   * Send registration failed message
   */
  async sendRegistrationFailed(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    error?: string,
    replyToMessageId?: string
  ): Promise<void> {
    const message = error
      ? `${ReplyMessages.REGISTRATION_FAILED}\n\nError: ${error}`
      : ReplyMessages.REGISTRATION_FAILED;
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      message,
      replyToMessageId
    );
  }

  /**
   * Send already registered message
   */
  async sendAlreadyRegistered(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    moiAccountId: string,
    replyToMessageId?: string
  ): Promise<void> {
    const trustClawId = truncateMoiId(moiAccountId);
    const message = `${ReplyMessages.ALREADY_REGISTERED}\n\n━━━━━━━━━━━━━━━\n\nTrustClaw ID: ${trustClawId}`;
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      message,
      replyToMessageId
    );
  }

  /**
   * Send session active message
   */
  async sendSessionActive(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    sessionId: string,
    replyToMessageId?: string
  ): Promise<void> {
    const message =
      `*🔍 Found an active session*\n\n` +
      `Looks like you've already approved access for this.\n\n` +
      `Session ID: ${sessionId}\n\n` +
      `I can ask questions using these permissions:\n` +
      `• 🍽 Food Preferences\n` +
      `• 🏥 Health Profile\n` +
      `• 📍 Delivery Address\n` +
      `• 💳 Payment\n\n` +
      `━━━━━━━━━━━━━━━\n\n` +
      `No need to ask you again — I'll reuse this session.\n\n` +
      `Still:\n` +
      `• scoped to these permissions\n` +
      `• time-limited\n` +
      `• fully revocable\n\n` +
      `━━━━━━━━━━━━━━━\n\n` +
      `Continuing with your request 🚀`;
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      message,
      replyToMessageId
    );
  }

  /**
   * Send session creation required message with signing instructions
   */
  async sendSessionCreationRequired(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    signingInstructions: string,
    replyToMessageId?: string
  ): Promise<void> {
    const message = `${ReplyMessages.SESSION_CREATION_REQUIRED}\n\n${signingInstructions}`;
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      message,
      replyToMessageId
    );
  }

  /**
   * Send session resumed message
   */
  async sendSessionResumed(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    customMessage: string,
    replyToMessageId?: string
  ): Promise<void> {
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      customMessage,
      replyToMessageId
    );
  }

  /**
   * Send session pending message
   */
  async sendSessionPending(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    customMessage: string,
    replyToMessageId?: string
  ): Promise<void> {
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      customMessage,
      replyToMessageId
    );
  }

  /**
   * Send session failed message
   */
  async sendSessionFailed(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    customMessage: string,
    replyToMessageId?: string
  ): Promise<void> {
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      customMessage,
      replyToMessageId
    );
  }

  /**
   * Send unknown intent message
   */
  async sendUnknownIntent(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    replyToMessageId?: string
  ): Promise<void> {
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      ReplyMessages.UNKNOWN_INTENT,
      replyToMessageId
    );
  }

  /**
   * Send category CIDs missing message
   */
  async sendCategoryCidsMissing(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    missingCategories: string[],
    replyToMessageId?: string
  ): Promise<void> {
    const friendlyNames: Record<string, string> = {
      FOOD: 'food preferences',
      HEALTH: 'health information',
      ADDRESS: 'delivery address',
      PAYMENT: 'payment details',
    };
    const categoryList = missingCategories
      .map((c) => `• ${friendlyNames[c] ?? c.toLowerCase()}`)
      .join('\n');
    const message =
      `It looks like your profile isn't fully set up yet.\n\n` +
      `To process your request, I need access to the following, but they haven't been added to your MOI account:\n\n` +
      `${categoryList}\n\n` +
      `Head over to your MOI account and add this information — once it's in place, just come back and try again. I'll be ready! 🙂`;
    await this.sendReply(channel, channelMeta, externalUserId, message, replyToMessageId);
  }

  /**
   * Send resume error message
   */
  async sendResumeError(
    channel: ChannelType,
    channelMeta: ChannelMeta,
    externalUserId: string,
    error: string,
    replyToMessageId?: string
  ): Promise<void> {
    const message = `${ReplyMessages.RESUME_ERROR}\n\nError: ${error}`;
    await this.sendReply(
      channel,
      channelMeta,
      externalUserId,
      message,
      replyToMessageId
    );
  }
}

/**
 * Default sender that logs replies (for development/testing)
 */
export class LoggingReplySender implements ReplySender {
  async send(reply: OutboundReply): Promise<void> {
    logger.info('Would send reply (logging mode)', {
      channel: reply.channel,
      externalUserId: reply.externalUserId,
      text: reply.text,
    });
  }
}

/**
 * Factory function to create ReplyService with default logging sender
 */
export function createReplyService(sender?: ReplySender): ReplyService {
  return new ReplyService(sender ?? new LoggingReplySender());
}
