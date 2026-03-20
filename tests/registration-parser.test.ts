import { describe, it, expect } from 'vitest';
import {
  parseRegistrationCommand,
  isRegistrationCommand,
  createExpectedSignedMessage,
  REGISTRATION_COMMAND,
} from '../src/services/registration-parser.js';

describe('registration-parser', () => {
  describe('isRegistrationCommand', () => {
    it('should return true for valid registration commands', () => {
      expect(isRegistrationCommand('/register {...}')).toBe(true);
      expect(isRegistrationCommand('/register{"accountId":"123"}')).toBe(true);
      expect(isRegistrationCommand('  /register {...}  ')).toBe(true);
    });

    it('should return false for non-registration commands', () => {
      expect(isRegistrationCommand('hello')).toBe(false);
      expect(isRegistrationCommand('/help')).toBe(false);
      expect(isRegistrationCommand('register {...}')).toBe(false);
      expect(isRegistrationCommand('')).toBe(false);
    });
  });

  describe('parseRegistrationCommand', () => {
    it('should parse valid registration payload', () => {
      const text = '/register {"accountId":"moi_123","publicKey":"pk_abc","signature":"sig_xyz","message":"register:telegram_user_456"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(true);
      expect(result.payload).toEqual({
        accountId: 'moi_123',
        publicKey: 'pk_abc',
        signature: 'sig_xyz',
        message: 'register:telegram_user_456',
      });
    });

    it('should parse payload without space after command', () => {
      const text = '/register{"accountId":"moi_123","publicKey":"pk_abc","signature":"sig_xyz","message":"test"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(true);
      expect(result.payload?.accountId).toBe('moi_123');
    });

    it('should handle extra whitespace', () => {
      const text = '  /register   {"accountId":"moi_123","publicKey":"pk_abc","signature":"sig_xyz","message":"test"}  ';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(true);
      expect(result.payload?.accountId).toBe('moi_123');
    });

    it('should fail for non-registration command', () => {
      const result = parseRegistrationCommand('hello world');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not a registration command');
    });

    it('should fail for missing payload', () => {
      const result = parseRegistrationCommand('/register');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing registration payload');
    });

    it('should fail for invalid JSON', () => {
      const result = parseRegistrationCommand('/register {invalid json}');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should fail for non-object payload', () => {
      const result = parseRegistrationCommand('/register "string"');

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be a JSON object');
    });

    it('should fail for array payload', () => {
      const result = parseRegistrationCommand('/register [1,2,3]');

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be a JSON object');
    });

    it('should fail for missing accountId', () => {
      const text = '/register {"publicKey":"pk","signature":"sig","message":"msg"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required field: accountId');
      expect(result.errorField).toBe('accountId');
    });

    it('should fail for missing publicKey', () => {
      const text = '/register {"accountId":"moi","signature":"sig","message":"msg"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required field: publicKey');
      expect(result.errorField).toBe('publicKey');
    });

    it('should fail for missing signature', () => {
      const text = '/register {"accountId":"moi","publicKey":"pk","message":"msg"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required field: signature');
      expect(result.errorField).toBe('signature');
    });

    it('should fail for missing message', () => {
      const text = '/register {"accountId":"moi","publicKey":"pk","signature":"sig"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required field: message');
      expect(result.errorField).toBe('message');
    });

    it('should fail for empty string fields', () => {
      const text = '/register {"accountId":"","publicKey":"pk","signature":"sig","message":"msg"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(false);
      expect(result.error).toContain("'accountId' must be a non-empty string");
    });

    it('should fail for non-string fields', () => {
      const text = '/register {"accountId":123,"publicKey":"pk","signature":"sig","message":"msg"}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(false);
      expect(result.error).toContain("'accountId' must be a non-empty string");
    });

    it('should trim whitespace from field values', () => {
      const text = '/register {"accountId":"  moi_123  ","publicKey":" pk ","signature":" sig ","message":" msg "}';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(true);
      expect(result.payload?.accountId).toBe('moi_123');
      expect(result.payload?.publicKey).toBe('pk');
      expect(result.payload?.signature).toBe('sig');
      expect(result.payload?.message).toBe('msg');
    });

    it('should handle nested JSON in payload', () => {
      const text = '/register {"accountId":"moi_123","publicKey":"pk_abc","signature":"sig_xyz","message":"register:telegram_user_456"} extra text';
      const result = parseRegistrationCommand(text);

      expect(result.success).toBe(true);
      expect(result.payload?.accountId).toBe('moi_123');
    });
  });

  describe('createExpectedSignedMessage', () => {
    it('should create correct message format', () => {
      expect(createExpectedSignedMessage('telegram', 'user_123')).toBe('register:telegram_user_123');
      expect(createExpectedSignedMessage('whatsapp', '+1234567890')).toBe('register:whatsapp_+1234567890');
    });
  });

  describe('REGISTRATION_COMMAND', () => {
    it('should be /register', () => {
      expect(REGISTRATION_COMMAND).toBe('/register');
    });
  });
});
