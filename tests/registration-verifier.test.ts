import { describe, it, expect } from 'vitest';
import {
  MockRegistrationVerifier,
  createMockVerifier,
} from '../src/services/registration-verifier.js';
import type { RegistrationPayload, VerificationContext } from '../src/types/registration.js';
import { ChannelType } from '../src/types/channel.js';

describe('MockRegistrationVerifier', () => {
  const createPayload = (overrides?: Partial<RegistrationPayload>): RegistrationPayload => ({
    accountId: 'moi_123',
    publicKey: 'pk_abc',
    signature: 'sig_xyz',
    message: 'register:telegram_user_456',
    ...overrides,
  });

  const createContext = (overrides?: Partial<VerificationContext>): VerificationContext => ({
    channel: ChannelType.TELEGRAM,
    externalUserId: 'user_456',
    ...overrides,
  });

  describe('default config (acceptAllValid: true)', () => {
    it('should accept well-formed payload with correct message', async () => {
      const verifier = createMockVerifier();
      const payload = createPayload();
      const context = createContext();

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(true);
      expect(result.details?.verifier).toBe('mock');
      expect(result.details?.mode).toBe('accept_all_valid');
    });

    it('should reject payload with incorrect message format', async () => {
      const verifier = createMockVerifier();
      const payload = createPayload({ message: 'wrong_format' });
      const context = createContext();

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid message format');
      expect(result.details?.reason).toBe('message_mismatch');
    });
  });

  describe('rejectedAccountIds config', () => {
    it('should reject accounts in the rejected list', async () => {
      const verifier = createMockVerifier({
        rejectedAccountIds: ['banned_account', 'moi_123'],
      });
      const payload = createPayload({ accountId: 'moi_123' });
      const context = createContext();

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Account ID is not allowed');
      expect(result.details?.reason).toBe('rejected_account');
    });

    it('should accept accounts not in the rejected list', async () => {
      const verifier = createMockVerifier({
        rejectedAccountIds: ['banned_account'],
      });
      const payload = createPayload({ accountId: 'good_account' });
      const context = createContext();

      // Update message to match
      payload.message = 'register:telegram_user_456';

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(true);
    });
  });

  describe('acceptedTestSignatures config', () => {
    it('should accept signatures in the accepted list', async () => {
      const verifier = createMockVerifier({
        acceptAllValid: false,
        acceptedTestSignatures: ['test_sig_1', 'test_sig_2'],
      });
      const payload = createPayload({ signature: 'test_sig_1' });
      const context = createContext();

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(true);
    });

    it('should reject signatures not in the accepted list', async () => {
      const verifier = createMockVerifier({
        acceptAllValid: false,
        acceptedTestSignatures: ['test_sig_1', 'test_sig_2'],
      });
      const payload = createPayload({ signature: 'unknown_sig' });
      const context = createContext();

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid signature');
      expect(result.details?.reason).toBe('signature_not_accepted');
    });
  });

  describe('simulatedDelayMs config', () => {
    it('should simulate delay', async () => {
      const verifier = createMockVerifier({
        simulatedDelayMs: 50,
      });
      const payload = createPayload();
      const context = createContext();

      const start = Date.now();
      await verifier.verify(payload, context);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some variance
    });
  });

  describe('message format validation', () => {
    it('should validate message matches channel and user', async () => {
      const verifier = createMockVerifier();
      const payload = createPayload({ message: 'register:telegram_user_456' });
      const context = createContext({ channel: ChannelType.TELEGRAM, externalUserId: 'user_456' });

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(true);
    });

    it('should reject message with wrong channel', async () => {
      const verifier = createMockVerifier();
      const payload = createPayload({ message: 'register:whatsapp_user_456' });
      const context = createContext({ channel: ChannelType.TELEGRAM, externalUserId: 'user_456' });

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(false);
      expect(result.details?.expected).toBe('register:telegram_user_456');
    });

    it('should reject message with wrong user', async () => {
      const verifier = createMockVerifier();
      const payload = createPayload({ message: 'register:telegram_different_user' });
      const context = createContext({ channel: ChannelType.TELEGRAM, externalUserId: 'user_456' });

      const result = await verifier.verify(payload, context);

      expect(result.valid).toBe(false);
    });
  });

  describe('createMockVerifier factory', () => {
    it('should create verifier with default config', () => {
      const verifier = createMockVerifier();
      expect(verifier).toBeInstanceOf(MockRegistrationVerifier);
    });

    it('should create verifier with custom config', () => {
      const verifier = createMockVerifier({
        acceptAllValid: false,
        acceptedTestSignatures: ['test'],
      });
      expect(verifier).toBeInstanceOf(MockRegistrationVerifier);
    });
  });
});
