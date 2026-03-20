import type { RegistrationPayload, RegistrationParseResult } from '../types/registration.js';
import { createLogger } from '../logger/index.js';

const logger = createLogger('registration-parser');

/**
 * Registration command prefix
 */
export const REGISTRATION_COMMAND = '/register';

/**
 * Required fields in the registration payload
 */
const REQUIRED_FIELDS: (keyof RegistrationPayload)[] = [
  'accountId',
  'publicKey',
  'signature',
  'message',
];

/**
 * Check if a message is a registration command
 */
export function isRegistrationCommand(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith(REGISTRATION_COMMAND);
}

/**
 * Extract JSON payload from registration command
 * Handles: /register {...} or /register{...}
 * Returns the raw text after /register for validation
 */
function extractJsonPayload(text: string): { payload: string | null; hasContent: boolean } {
  const trimmed = text.trim();

  // Remove the /register prefix
  const afterCommand = trimmed.slice(REGISTRATION_COMMAND.length).trim();

  if (!afterCommand) {
    return { payload: null, hasContent: false };
  }

  // Find the JSON object
  const jsonStart = afterCommand.indexOf('{');
  if (jsonStart === -1) {
    // There's content but no JSON object - could be string, array, etc.
    return { payload: afterCommand, hasContent: true };
  }

  // Find matching closing brace
  let braceCount = 0;
  let jsonEnd = -1;

  for (let i = jsonStart; i < afterCommand.length; i++) {
    if (afterCommand[i] === '{') {
      braceCount++;
    } else if (afterCommand[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        jsonEnd = i;
        break;
      }
    }
  }

  if (jsonEnd === -1) {
    return { payload: null, hasContent: true };
  }

  return { payload: afterCommand.slice(jsonStart, jsonEnd + 1), hasContent: true };
}

/**
 * Validate that a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Parse a registration command and extract the payload
 *
 * @param text - The raw message text
 * @returns Parse result with payload or error
 */
export function parseRegistrationCommand(text: string): RegistrationParseResult {
  logger.debug('Parsing registration command', { textLength: text.length });

  // Check if it's a registration command
  if (!isRegistrationCommand(text)) {
    return {
      success: false,
      error: 'Not a registration command',
    };
  }

  // Extract JSON payload
  const { payload: jsonPayload, hasContent } = extractJsonPayload(text);

  if (!hasContent) {
    logger.debug('No content found after registration command');
    return {
      success: false,
      error: 'Missing registration payload. Expected format: /register {"accountId":"...","publicKey":"...","signature":"...","message":"..."}',
    };
  }

  if (!jsonPayload) {
    logger.debug('No valid JSON object found in registration command');
    return {
      success: false,
      error: 'Invalid JSON format in registration payload',
    };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch (e) {
    logger.debug('Failed to parse JSON payload', { error: (e as Error).message });
    return {
      success: false,
      error: 'Invalid JSON format in registration payload',
    };
  }

  // Validate it's an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      success: false,
      error: 'Registration payload must be a JSON object',
    };
  }

  const payloadObj = parsed as Record<string, unknown>;

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in payloadObj)) {
      return {
        success: false,
        error: `Missing required field: ${field}`,
        errorField: field,
      };
    }

    if (!isNonEmptyString(payloadObj[field])) {
      return {
        success: false,
        error: `Field '${field}' must be a non-empty string`,
        errorField: field,
      };
    }
  }

  // Build validated payload
  const payload: RegistrationPayload = {
    accountId: (payloadObj['accountId'] as string).trim(),
    publicKey: (payloadObj['publicKey'] as string).trim(),
    signature: (payloadObj['signature'] as string).trim(),
    message: (payloadObj['message'] as string).trim(),
  };

  logger.debug('Successfully parsed registration payload', {
    accountId: payload.accountId,
    messagePrefix: payload.message.substring(0, 20),
  });

  return {
    success: true,
    payload,
  };
}

/**
 * Create the expected signed message format for registration
 *
 * @param channel - The channel type
 * @param externalUserId - The user's external ID
 * @returns Expected message format
 */
export function createExpectedSignedMessage(channel: string, externalUserId: string): string {
  return `register:${channel}_${externalUserId}`;
}
