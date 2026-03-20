import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowHandler } from '../src/handlers/workflow-handler.js';
import type { RegistrationChecker } from '../src/services/registration-checker.js';
import type { ReplyService } from '../src/services/reply-service.js';
import type { RegistrationService } from '../src/services/registration-service.js';
import type { InboundMessage, TelegramChannelMeta } from '../src/types/index.js';
import { ChannelType } from '../src/types/index.js';

describe('WorkflowHandler', () => {
  let mockRegistrationChecker: RegistrationChecker;
  let mockReplyService: ReplyService;
  let mockRegistrationService: RegistrationService;
  let handler: WorkflowHandler;

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
    mockRegistrationChecker = {
      check: vi.fn(),
    } as unknown as RegistrationChecker;

    mockReplyService = {
      sendRegistrationRequired: vi.fn().mockResolvedValue(undefined),
      sendWorkflowContinue: vi.fn().mockResolvedValue(undefined),
      sendInternalError: vi.fn().mockResolvedValue(undefined),
      sendRegistrationSuccess: vi.fn().mockResolvedValue(undefined),
      sendRegistrationFailed: vi.fn().mockResolvedValue(undefined),
      sendAlreadyRegistered: vi.fn().mockResolvedValue(undefined),
      sendReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReplyService;

    mockRegistrationService = {
      isRegistrationCommand: vi.fn(),
      processRegistration: vi.fn(),
    } as unknown as RegistrationService;

    handler = new WorkflowHandler(
      mockRegistrationChecker,
      mockReplyService,
      mockRegistrationService
    );
  });

  describe('handle - normal messages', () => {
    beforeEach(() => {
      vi.mocked(mockRegistrationService.isRegistrationCommand).mockReturnValue(false);
    });

    it('should send registration required for unregistered user', async () => {
      vi.mocked(mockRegistrationChecker.check).mockResolvedValue({
        isRegistered: false,
      });

      const message = createTestMessage();
      const result = await handler.handle(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('registration_required');
      expect(mockReplyService.sendRegistrationRequired).toHaveBeenCalledWith(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );
    });

    it('should send workflow continue for registered user', async () => {
      vi.mocked(mockRegistrationChecker.check).mockResolvedValue({
        isRegistered: true,
        moiAccountId: 'moi_abc',
        mappingId: 'pm_123',
      });

      const message = createTestMessage();
      const result = await handler.handle(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('workflow_continue');
      expect(result.moiAccountId).toBe('moi_abc');
      expect(mockReplyService.sendWorkflowContinue).toHaveBeenCalledWith(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        message.messageId
      );
    });

    it('should check registration with correct parameters', async () => {
      vi.mocked(mockRegistrationChecker.check).mockResolvedValue({
        isRegistered: false,
      });

      const message = createTestMessage({
        channel: ChannelType.WHATSAPP,
        externalUserId: '+1234567890',
      });

      await handler.handle(message);

      expect(mockRegistrationChecker.check).toHaveBeenCalledWith({
        channel: ChannelType.WHATSAPP,
        externalUserId: '+1234567890',
      });
    });
  });

  describe('handle - registration commands', () => {
    it('should process registration command successfully', async () => {
      vi.mocked(mockRegistrationService.isRegistrationCommand).mockReturnValue(true);
      vi.mocked(mockRegistrationService.processRegistration).mockResolvedValue({
        success: true,
        action: 'registered',
        moiAccountId: 'moi_new',
      });

      const message = createTestMessage({
        text: '/register {"accountId":"moi_new","publicKey":"pk","signature":"sig","message":"register:telegram_user_456"}',
      });

      const result = await handler.handle(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('registered');
      expect(result.moiAccountId).toBe('moi_new');
      expect(mockReplyService.sendRegistrationSuccess).toHaveBeenCalledWith(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        'moi_new',
        message.messageId
      );
    });

    it('should handle already registered user', async () => {
      vi.mocked(mockRegistrationService.isRegistrationCommand).mockReturnValue(true);
      vi.mocked(mockRegistrationService.processRegistration).mockResolvedValue({
        success: false,
        action: 'already_registered',
        moiAccountId: 'existing_moi',
        error: 'Already registered',
      });

      const message = createTestMessage({ text: '/register {...}' });

      const result = await handler.handle(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('already_registered');
      expect(mockReplyService.sendAlreadyRegistered).toHaveBeenCalledWith(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        'existing_moi',
        message.messageId
      );
    });

    it('should handle invalid payload', async () => {
      vi.mocked(mockRegistrationService.isRegistrationCommand).mockReturnValue(true);
      vi.mocked(mockRegistrationService.processRegistration).mockResolvedValue({
        success: false,
        action: 'invalid_payload',
        error: 'Missing required field: accountId',
      });

      const message = createTestMessage({ text: '/register {}' });

      const result = await handler.handle(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('registration_failed');
      expect(mockReplyService.sendRegistrationFailed).toHaveBeenCalledWith(
        message.channel,
        message.channelMeta,
        message.externalUserId,
        'Missing required field: accountId',
        message.messageId
      );
    });

    it('should handle verification failure', async () => {
      vi.mocked(mockRegistrationService.isRegistrationCommand).mockReturnValue(true);
      vi.mocked(mockRegistrationService.processRegistration).mockResolvedValue({
        success: false,
        action: 'verification_failed',
        error: 'Invalid signature',
      });

      const message = createTestMessage({ text: '/register {...}' });

      const result = await handler.handle(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('registration_failed');
      expect(mockReplyService.sendRegistrationFailed).toHaveBeenCalled();
    });

    it('should handle internal errors', async () => {
      vi.mocked(mockRegistrationService.isRegistrationCommand).mockReturnValue(true);
      vi.mocked(mockRegistrationService.processRegistration).mockResolvedValue({
        success: false,
        action: 'error',
        error: 'Database error',
      });

      const message = createTestMessage({ text: '/register {...}' });

      const result = await handler.handle(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(mockReplyService.sendInternalError).toHaveBeenCalled();
    });
  });

  describe('handle - without registration service', () => {
    it('should return error if registration service not configured', async () => {
      const handlerWithoutRegistration = new WorkflowHandler(
        mockRegistrationChecker,
        mockReplyService
        // no registration service
      );

      // Manually check for registration command
      const message = createTestMessage({ text: '/register {...}' });

      // Without registration service, isRegistrationCommand will be undefined
      // so it should fall through to normal flow
      vi.mocked(mockRegistrationChecker.check).mockResolvedValue({
        isRegistered: false,
      });

      const result = await handlerWithoutRegistration.handle(message);

      // Should treat as normal message since registration service is not available
      expect(result.action).toBe('registration_required');
    });
  });
});
