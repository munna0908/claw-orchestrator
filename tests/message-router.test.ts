import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageRouter } from '../src/services/message-router.js';
import type { WorkflowHandler } from '../src/handlers/workflow-handler.js';
import type { InboundMessage, TelegramChannelMeta } from '../src/types/index.js';
import { ChannelType } from '../src/types/index.js';
import { resetConfig } from '../src/config/index.js';

describe('MessageRouter', () => {
  let mockWorkflowHandler: WorkflowHandler;
  let router: MessageRouter;

  const createTestMessage = (overrides?: Partial<InboundMessage>): InboundMessage => ({
    messageId: 'msg_123',
    channel: ChannelType.TELEGRAM,
    channelMeta: {
      chatId: 12345,
      chatType: 'private',
      messageId: 100,
    } as TelegramChannelMeta,
    externalUserId: 'user_456',
    text: 'Hello',
    timestamp: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    resetConfig();
    process.env['ENABLE_TELEGRAM'] = 'true';
    process.env['ENABLE_WHATSAPP'] = 'false';

    mockWorkflowHandler = {
      handle: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'msg_123',
        action: 'workflow_continue',
      }),
    } as unknown as WorkflowHandler;

    router = new MessageRouter(mockWorkflowHandler);
  });

  afterEach(() => {
    resetConfig();
    delete process.env['ENABLE_TELEGRAM'];
    delete process.env['ENABLE_WHATSAPP'];
  });

  describe('route', () => {
    it('should route valid message to workflow handler', async () => {
      const message = createTestMessage();
      const result = await router.route(message);

      expect(result.success).toBe(true);
      expect(mockWorkflowHandler.handle).toHaveBeenCalledWith(message);
    });

    it('should reject message with missing messageId', async () => {
      const message = createTestMessage({ messageId: '' });
      const result = await router.route(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.error).toContain('Missing messageId');
      expect(mockWorkflowHandler.handle).not.toHaveBeenCalled();
    });

    it('should reject message with missing channel', async () => {
      const message = createTestMessage({ channel: '' as ChannelType });
      const result = await router.route(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.error).toContain('Missing channel');
    });

    it('should reject message with missing externalUserId', async () => {
      const message = createTestMessage({ externalUserId: '' });
      const result = await router.route(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.error).toContain('Missing externalUserId');
    });

    it('should reject message from disabled channel', async () => {
      const message = createTestMessage({ channel: ChannelType.WHATSAPP });
      const result = await router.route(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.error).toContain('not enabled');
      expect(mockWorkflowHandler.handle).not.toHaveBeenCalled();
    });

    it('should handle workflow handler errors gracefully', async () => {
      vi.mocked(mockWorkflowHandler.handle).mockRejectedValue(new Error('Handler error'));

      const message = createTestMessage();
      const result = await router.route(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.error).toBe('Handler error');
    });
  });
});
