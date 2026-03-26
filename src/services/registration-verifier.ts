import type {
  RegistrationPayload,
  VerificationContext,
  VerificationResult,
  MockVerifierConfig,
} from '../types/registration.js';
import { createExpectedSignedMessage } from './registration-parser.js';
import { createLogger } from '../logger/index.js';
import { blake2b } from '@noble/hashes/blake2.js';
import * as secp256k1 from '@noble/secp256k1';

const logger = createLogger('registration-verifier');

/**
 * Registration Verifier Interface
 *
 * This interface allows pluggable verification implementations:
 * - MockRegistrationVerifier (v1, development/testing)
 * - ExternalRegistrationVerifier (future, delegates to backend service)
 * - CryptoRegistrationVerifier (future, local cryptographic verification)
 *
 * The plugin orchestrates registration but does not own cryptographic truth.
 * This design allows verification to be delegated to another backend later.
 */
export interface RegistrationVerifier {
  /**
   * Verify a registration payload
   *
   * @param payload - The registration payload to verify
   * @param context - Context about the registration (channel, user, etc.)
   * @returns Verification result
   */
  verify(payload: RegistrationPayload, context: VerificationContext): Promise<VerificationResult>;
}

/**
 * Mock Registration Verifier
 *
 * A configurable mock implementation for development and testing.
 *
 * Behavior:
 * - If acceptAllValid is true, accepts any well-formed payload
 * - If acceptedTestSignatures is set, only accepts those signatures
 * - If rejectedAccountIds is set, rejects those account IDs
 * - Can simulate verification delay for testing async behavior
 */
export class MockRegistrationVerifier implements RegistrationVerifier {
  private readonly config: MockVerifierConfig;

  constructor(config: MockVerifierConfig = {}) {
    this.config = {
      acceptAllValid: true,
      acceptedTestSignatures: [],
      rejectedAccountIds: [],
      simulatedDelayMs: 0,
      ...config,
    };

    logger.info('MockRegistrationVerifier initialized', {
      acceptAllValid: this.config.acceptAllValid,
      acceptedTestSignaturesCount: this.config.acceptedTestSignatures?.length ?? 0,
      rejectedAccountIdsCount: this.config.rejectedAccountIds?.length ?? 0,
    });
  }

  async verify(
    payload: RegistrationPayload,
    context: VerificationContext
  ): Promise<VerificationResult> {
    logger.debug('Verifying registration payload', {
      accountId: payload.accountId,
      channel: context.channel,
      externalUserId: context.externalUserId,
    });

    // Simulate delay if configured
    if (this.config.simulatedDelayMs && this.config.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.simulatedDelayMs));
    }

    // Check rejected account IDs
    if (this.config.rejectedAccountIds?.includes(payload.accountId)) {
      logger.debug('Account ID is in rejected list', { accountId: payload.accountId });
      return {
        valid: false,
        error: 'Account ID is not allowed',
        details: { reason: 'rejected_account' },
      };
    }

    // Validate message format
    const expectedMessage = createExpectedSignedMessage(context.channel, context.externalUserId);
    if (payload.message !== expectedMessage) {
      logger.debug('Message format mismatch', {
        expected: expectedMessage,
        received: payload.message,
      });
      return {
        valid: false,
        error: 'Invalid message format. Expected: ' + expectedMessage,
        details: { reason: 'message_mismatch', expected: expectedMessage },
      };
    }

    // Check test signatures if configured
    if (
      this.config.acceptedTestSignatures &&
      this.config.acceptedTestSignatures.length > 0
    ) {
      if (this.config.acceptedTestSignatures.includes(payload.signature)) {
        logger.debug('Signature found in accepted test signatures list');
        return {
          valid: true,
          details: { verifier: 'mock', mode: 'accepted_test_signature' },
        };
      } else {
        logger.debug('Signature not in accepted test signatures list');
        return {
          valid: false,
          error: 'Invalid signature',
          details: { reason: 'signature_not_accepted' },
        };
      }
    }

    // Accept all valid if configured
    if (this.config.acceptAllValid) {
      logger.debug('Accepting payload (acceptAllValid=true)');
      return {
        valid: true,
        details: { verifier: 'mock', mode: 'accept_all_valid' },
      };
    }

    // Default: reject if no other rules matched
    return {
      valid: false,
      error: 'Verification failed',
      details: { reason: 'no_matching_rule' },
    };
  }
}

/**
 * Factory function to create a mock verifier with default config
 */
export function createMockVerifier(config?: MockVerifierConfig): MockRegistrationVerifier {
  return new MockRegistrationVerifier(config);
}

/**
 * Crypto Registration Verifier
 *
 * Verifies MOI ECDSA_S256 signatures produced by the MOI Wallet via moi.sign.
 *
 * MOI signature wire format (hex-encoded):
 *   [prefix: 1 byte][sigLen: 1 byte][BIP66-DER-sig: sigLen bytes][recoveryByte: 1 byte]
 *   prefix = 0x01 → ECDSA_S256
 *
 * Strategy:
 *   1. Hash message with blake2b(32)
 *   2. Recover the signing public key from the signature using the recovery byte
 *      — this tells us exactly which key was used, regardless of how many keys the account has
 *   3. Fetch ALL account keys from MOI RPC for the claimed accountId
 *   4. Check that the recovered key matches one of the registered keys
 *
 * This approach is robust to multi-key accounts — we never guess which key to use.
 */
export class CryptoRegistrationVerifier implements RegistrationVerifier {
  private readonly rpcUrl: string;

  constructor(rpcUrl = 'https://dev.voyage-rpc.moi.technology/devnet/') {
    this.rpcUrl = rpcUrl;
  }

  async verify(
    payload: RegistrationPayload,
    context: VerificationContext,
  ): Promise<VerificationResult> {
    logger.debug('CryptoRegistrationVerifier: verifying', {
      accountId: payload.accountId,
      channel: context.channel,
      externalUserId: context.externalUserId,
    });

    // 1. Validate message format
    const expectedMessage = createExpectedSignedMessage(context.channel, context.externalUserId);
    if (payload.message !== expectedMessage) {
      return {
        valid: false,
        error: `Invalid message. Expected: ${expectedMessage}`,
        details: { reason: 'message_mismatch' },
      };
    }

    try {
      // 2. Parse signature bytes
      const sigHex = payload.signature.startsWith('0x')
        ? payload.signature.slice(2)
        : payload.signature;
      const sigBytes = hexToBytes(sigHex);

      if (sigBytes.length < 4) {
        return { valid: false, error: 'Signature too short', details: { reason: 'invalid_signature' } };
      }

      const prefix = sigBytes[0]!;
      if (prefix !== 0x01) {
        return { valid: false, error: `Unsupported signature prefix: 0x${prefix.toString(16)}`, details: { reason: 'unsupported_algorithm' } };
      }

      const sigLen = sigBytes[1]!;
      const derSig = sigBytes.slice(2, 2 + sigLen);
      const recoveryByte = sigBytes[2 + sigLen]!; // recovery/parity bit

      // 3. Hash the message
      const messageBytes = new TextEncoder().encode(payload.message);
      const hash = blake2b(messageBytes, { dkLen: 32 });

      // 4. Convert DER signature → compact r||s (64 bytes)
      const sig64 = derToCompact(derSig);

      // 5. Fetch ALL registered keys for this account from MOI RPC
      const accountKeys = await this.fetchAccountKeys(payload.accountId);
      if (accountKeys.length === 0) {
        logger.warn('CryptoRegistrationVerifier: no keys found for account', { accountId: payload.accountId });
        return { valid: false, error: 'No public keys registered for this account', details: { reason: 'no_account_keys' } };
      }

      const normalizedAccountKeys = accountKeys.map((k) =>
        k.startsWith('0x') ? k.slice(2).toLowerCase() : k.toLowerCase()
      );

      // 6. Try both ECDSA recovery IDs (0 and 1).
      //    The MOI wallet encodes the recovery bit in the last byte but the exact
      //    bit-level convention varies across wallet versions. Trying both is safe:
      //    a forged signature cannot recover to a victim's registered key without
      //    breaking ECDSA, so accepting either candidate that matches is correct.
      let matchedKey: string | null = null;
      for (const recoveryId of [0, 1] as const) {
        try {
          const sig = secp256k1.Signature.fromBytes(sig64).addRecoveryBit(recoveryId);
          const sigRecoveredBytes = sig.toBytes('recovered');
          const recoveredPubKey = secp256k1.recoverPublicKey(sigRecoveredBytes, hash, { prehash: false });
          const recoveredHex = bytesToHex(recoveredPubKey);

          if (normalizedAccountKeys.includes(recoveredHex.toLowerCase())) {
            matchedKey = recoveredHex;
            break;
          }
        } catch {
          // This recovery ID produced an invalid curve point — skip it
        }
      }

      logger.debug('CryptoRegistrationVerifier: key match result', {
        matched: matchedKey !== null,
        accountId: payload.accountId,
        keysChecked: accountKeys.length,
      });

      return matchedKey !== null
        ? { valid: true, details: { verifier: 'crypto', algorithm: 'ECDSA_S256', recoveredKey: matchedKey } }
        : { valid: false, error: 'Signing key is not registered for this account', details: { reason: 'key_not_registered' } };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`CryptoRegistrationVerifier: exception: ${msg}`);
      return { valid: false, error: `Verification error: ${msg}`, details: { reason: 'exception' } };
    }
  }

  private async fetchAccountKeys(accountId: string): Promise<string[]> {
    // Step 1: get the latest tesseract hash for this account (required by moi.AccountKeys)
    const metaRes = await this.rpcCall('moi.AccountMetaInfo', [{ id: accountId }]);
    const tesseractHash = metaRes?.tesseract_hash as string | undefined;
    if (!tesseractHash) {
      throw new Error(`Could not get tesseract hash for account ${accountId}`);
    }

    // Step 2: fetch all account keys at that tesseract
    const keysRes = await this.rpcCall('moi.AccountKeys', [{ id: accountId, options: { tesseract_hash: tesseractHash } }]);

    const keys: unknown[] = Array.isArray(keysRes) ? keysRes : [];
    return keys
      .map((k: any) => k?.publicKey ?? k?.pub_key ?? k?.pubKey ?? '')
      .filter((k: string) => k.length > 0);
  }

  private async rpcCall(method: string, params: unknown[]): Promise<any> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

    if (!res.ok) throw new Error(`MOI RPC HTTP ${res.status}`);

    const json = await res.json() as any;
    if (json.error) throw new Error(`MOI RPC error: ${json.error.message ?? JSON.stringify(json.error)}`);

    return json.result;
  }
}

/** Convert a Uint8Array to lowercase hex string */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Convert a hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Decode a BIP66 DER-encoded signature into a 64-byte compact r||s buffer.
 * DER format: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
 */
function derToCompact(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('Expected DER sequence (0x30)');
  if (der[2] !== 0x02) throw new Error('Expected DER integer for r (0x02)');

  const rLen = der[3] as number;
  const rRaw = der.slice(4, 4 + rLen);

  if (der[4 + rLen] !== 0x02) throw new Error('Expected DER integer for s (0x02)');
  const sLen = der[5 + rLen] as number;
  const sRaw = der.slice(6 + rLen, 6 + rLen + sLen);

  // DER integers may have a leading 0x00 padding byte — strip it, then pad to 32 bytes
  const r32 = padTo32(stripLeadingZero(rRaw));
  const s32 = padTo32(stripLeadingZero(sRaw));

  const compact = new Uint8Array(64);
  compact.set(r32, 0);
  compact.set(s32, 32);
  return compact;
}

function stripLeadingZero(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0x00 ? bytes.slice(1) : bytes;
}

function padTo32(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 32) return bytes;
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return padded;
}

export function createCryptoVerifier(rpcUrl?: string): CryptoRegistrationVerifier {
  return new CryptoRegistrationVerifier(rpcUrl);
}

/**
 * Placeholder for future external verifier
 *
 * This would delegate verification to an external service:
 * - Intelligence Service
 * - Dedicated auth service
 * - Blockchain verification endpoint
 */
export class ExternalRegistrationVerifier implements RegistrationVerifier {
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    logger.info('ExternalRegistrationVerifier initialized', { endpoint });
  }

  async verify(
    payload: RegistrationPayload,
    context: VerificationContext
  ): Promise<VerificationResult> {
    // TODO: Implement external verification call
    // This would make an HTTP request to the verification endpoint
    logger.warn('ExternalRegistrationVerifier not yet implemented, rejecting');

    return {
      valid: false,
      error: 'External verification not yet implemented',
      details: {
        endpoint: this.endpoint,
        payload: { accountId: payload.accountId },
        context: { channel: context.channel, externalUserId: context.externalUserId },
      },
    };
  }
}
