import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPlugin,
  ParticipantOrchestratorPlugin,
  resetInMemoryStore,
  ChannelType,
  type InboundMessage,
  type TelegramChannelMeta,
} from '../src/index.js';
import { resetConfig } from '../src/config/index.js';

describe('ParticipantOrchestratorPlugin', () => {
  let plugin: ParticipantOrchestratorPlugin;

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
    resetInMemoryStore();
    process.env['ENABLE_TELEGRAM'] = 'true';
    plugin = createPlugin();
  });

  afterEach(() => {
    resetConfig();
    resetInMemoryStore();
    delete process.env['ENABLE_TELEGRAM'];
  });

  describe('createPlugin', () => {
    it('should create a plugin instance', () => {
      expect(plugin).toBeInstanceOf(ParticipantOrchestratorPlugin);
      expect(plugin.name).toBe('participant-orchestrator');
      expect(plugin.version).toBe('0.3.0');
    });

    it('should accept custom mock verifier config', () => {
      const customPlugin = createPlugin({
        mockVerifierConfig: {
          acceptAllValid: false,
          acceptedTestSignatures: ['test_sig'],
        },
      });
      expect(customPlugin).toBeInstanceOf(ParticipantOrchestratorPlugin);
    });
  });

  describe('handleMessage - normal messages', () => {
    it('should return registration_required for unregistered user', async () => {
      const message = createTestMessage();
      const result = await plugin.handleMessage(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('registration_required');
    });

    it('should return workflow_continue for registered user', async () => {
      // Register the user first
      const store = plugin.getParticipantStore();
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user_456',
        moiAccountId: 'moi_abc',
      });

      const message = createTestMessage();
      const result = await plugin.handleMessage(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('workflow_continue');
      expect(result.moiAccountId).toBe('moi_abc');
    });
  });

  describe('handleMessage - registration flow', () => {
    it('should successfully register a new user', async () => {
      const message = createTestMessage({
        text: '/register {"accountId":"moi_new","publicKey":"pk_abc","signature":"sig_xyz","message":"register:telegram_user_456"}',
      });

      const result = await plugin.handleMessage(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('registered');
      expect(result.moiAccountId).toBe('moi_new');

      // Verify user is now registered
      const store = plugin.getParticipantStore();
      const lookup = await store.lookup({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user_456',
      });
      expect(lookup.found).toBe(true);
      expect(lookup.mapping?.moiAccountId).toBe('moi_new');
    });

    it('should return already_registered for existing user', async () => {
      // Pre-register the user
      const store = plugin.getParticipantStore();
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user_456',
        moiAccountId: 'existing_moi',
      });

      const message = createTestMessage({
        text: '/register {"accountId":"new_moi","publicKey":"pk","signature":"sig","message":"register:telegram_user_456"}',
      });

      const result = await plugin.handleMessage(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('already_registered');
      expect(result.moiAccountId).toBe('existing_moi');
    });

    it('should fail for invalid JSON payload', async () => {
      const message = createTestMessage({
        text: '/register {invalid json}',
      });

      const result = await plugin.handleMessage(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('registration_failed');
    });

    it('should fail for missing required fields', async () => {
      const message = createTestMessage({
        text: '/register {"accountId":"moi_123"}',
      });

      const result = await plugin.handleMessage(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('registration_failed');
      expect(result.error).toContain('Missing required field');
    });

    it('should fail for wrong message format', async () => {
      const message = createTestMessage({
        text: '/register {"accountId":"moi_123","publicKey":"pk","signature":"sig","message":"wrong_format"}',
      });

      const result = await plugin.handleMessage(message);

      expect(result.success).toBe(false);
      expect(result.action).toBe('registration_failed');
      expect(result.error).toContain('Invalid message format');
    });

    it('should work with WhatsApp channel', async () => {
      process.env['ENABLE_WHATSAPP'] = 'true';
      resetConfig(); // Reset to pick up the new env var
      const whatsappPlugin = createPlugin();

      const message = createTestMessage({
        channel: ChannelType.WHATSAPP,
        externalUserId: '+1234567890',
        channelMeta: {
          phoneNumber: '+1234567890',
          messageId: 'wa_msg_123',
        },
        text: '/register {"accountId":"moi_wa","publicKey":"pk","signature":"sig","message":"register:whatsapp_+1234567890"}',
      });

      const result = await whatsappPlugin.handleMessage(message);

      expect(result.success).toBe(true);
      expect(result.action).toBe('registered');
      expect(result.moiAccountId).toBe('moi_wa');

      delete process.env['ENABLE_WHATSAPP'];
    });
  });

  describe('healthCheck', () => {
    it('should return ok status with registration feature', async () => {
      const health = await plugin.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.details?.plugin).toBe('participant-orchestrator');
      expect(health.details?.version).toBe('0.3.0');
      expect((health.details?.features as Record<string, boolean>)?.registration).toBe(true);
    });
  });

  describe('getParticipantStore', () => {
    it('should return the participant store', () => {
      const store = plugin.getParticipantStore();
      expect(store).toBeDefined();
      expect(typeof store.lookup).toBe('function');
      expect(typeof store.create).toBe('function');
    });
  });

  describe('getRegistrationService', () => {
    it('should return the registration service', () => {
      const service = plugin.getRegistrationService();
      expect(service).toBeDefined();
      expect(typeof service.isRegistrationCommand).toBe('function');
      expect(typeof service.processRegistration).toBe('function');
    });
  });
});
