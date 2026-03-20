import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegistrationService } from '../src/services/registration-service.js';
import { MockRegistrationVerifier } from '../src/services/registration-verifier.js';
import { InMemoryParticipantMappingStore } from '../src/stores/in-memory-store.js';
import { ChannelType } from '../src/types/channel.js';
import type { VerificationContext } from '../src/types/registration.js';

describe('RegistrationService', () => {
  let store: InMemoryParticipantMappingStore;
  let verifier: MockRegistrationVerifier;
  let service: RegistrationService;

  const createContext = (overrides?: Partial<VerificationContext>): VerificationContext => ({
    channel: ChannelType.TELEGRAM,
    externalUserId: 'user_456',
    ...overrides,
  });

  beforeEach(() => {
    store = new InMemoryParticipantMappingStore();
    verifier = new MockRegistrationVerifier({ acceptAllValid: true });
    service = new RegistrationService(verifier, store);
  });

  describe('isRegistrationCommand', () => {
    it('should identify registration commands', () => {
      expect(service.isRegistrationCommand('/register {...}')).toBe(true);
      expect(service.isRegistrationCommand('hello')).toBe(false);
    });
  });

  describe('processRegistration', () => {
    it('should successfully register a new user', async () => {
      const text = '/register {"accountId":"moi_123","publicKey":"pk_abc","signature":"sig_xyz","message":"register:telegram_user_456"}';
      const context = createContext();

      const result = await service.processRegistration(text, context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('registered');
      expect(result.moiAccountId).toBe('moi_123');

      // Verify mapping was stored
      const lookup = await store.lookup({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user_456',
      });
      expect(lookup.found).toBe(true);
      expect(lookup.mapping?.moiAccountId).toBe('moi_123');
    });

    it('should return already_registered for existing user', async () => {
      // Pre-register the user
      await store.create({
        channel: ChannelType.TELEGRAM,
        externalUserId: 'user_456',
        moiAccountId: 'existing_moi',
      });

      const text = '/register {"accountId":"new_moi","publicKey":"pk","signature":"sig","message":"register:telegram_user_456"}';
      const context = createContext();

      const result = await service.processRegistration(text, context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('already_registered');
      expect(result.moiAccountId).toBe('existing_moi');
      expect(result.error).toContain('already registered');
    });

    it('should fail for invalid payload format', async () => {
      const text = '/register not_json';
      const context = createContext();

      const result = await service.processRegistration(text, context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('invalid_payload');
      expect(result.error).toContain('Invalid JSON format');
    });

    it('should fail for missing required fields', async () => {
      const text = '/register {"accountId":"moi_123"}';
      const context = createContext();

      const result = await service.processRegistration(text, context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('invalid_payload');
      expect(result.error).toContain('Missing required field');
    });

    it('should fail for invalid JSON', async () => {
      const text = '/register {invalid}';
      const context = createContext();

      const result = await service.processRegistration(text, context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('invalid_payload');
      expect(result.error).toContain('Invalid JSON');
    });

    it('should fail when verification fails', async () => {
      // Create verifier that rejects the account
      const strictVerifier = new MockRegistrationVerifier({
        rejectedAccountIds: ['banned_account'],
      });
      const strictService = new RegistrationService(strictVerifier, store);

      const text = '/register {"accountId":"banned_account","publicKey":"pk","signature":"sig","message":"register:telegram_user_456"}';
      const context = createContext();

      const result = await strictService.processRegistration(text, context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('verification_failed');
      expect(result.error).toContain('not allowed');
    });

    it('should fail when message format is wrong', async () => {
      const text = '/register {"accountId":"moi_123","publicKey":"pk","signature":"sig","message":"wrong_format"}';
      const context = createContext();

      const result = await service.processRegistration(text, context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('verification_failed');
      expect(result.error).toContain('Invalid message format');
    });

    it('should handle store errors gracefully', async () => {
      // Mock store to throw error
      const failingStore = {
        lookup: vi.fn().mockResolvedValue({ found: false }),
        create: vi.fn().mockRejectedValue(new Error('Database error')),
        delete: vi.fn(),
        findByMoiAccountId: vi.fn(),
      };
      const failingService = new RegistrationService(verifier, failingStore);

      const text = '/register {"accountId":"moi_123","publicKey":"pk","signature":"sig","message":"register:telegram_user_456"}';
      const context = createContext();

      const result = await failingService.processRegistration(text, context);

      expect(result.success).toBe(false);
      expect(result.action).toBe('error');
      expect(result.error).toContain('Failed to complete registration');
    });
  });

  describe('validatePayload', () => {
    it('should validate correct payload', async () => {
      const payload = {
        accountId: 'moi_123',
        publicKey: 'pk_abc',
        signature: 'sig_xyz',
        message: 'register:telegram_user_456',
      };
      const context = createContext();

      const result = await service.validatePayload(payload, context);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid payload', async () => {
      const payload = {
        accountId: 'moi_123',
        publicKey: 'pk_abc',
        signature: 'sig_xyz',
        message: 'wrong_message',
      };
      const context = createContext();

      const result = await service.validatePayload(payload, context);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
