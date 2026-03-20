/**
 * Supported messaging channels
 */
export const ChannelType = {
  TELEGRAM: 'telegram',
  WHATSAPP: 'whatsapp',
} as const;

export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

/**
 * Channel-specific metadata
 */
export interface TelegramChannelMeta {
  chatId: number;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  messageId: number;
}

export interface WhatsAppChannelMeta {
  phoneNumber: string;
  messageId: string;
}

export type ChannelMeta = TelegramChannelMeta | WhatsAppChannelMeta;

/**
 * Unified channel identifier
 */
export interface ChannelIdentifier {
  type: ChannelType;
  meta: ChannelMeta;
}
