import { getConfig, type LogLevel } from '../config/index.js';

/**
 * Log entry structure for structured logging
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown> | undefined;
  error?: {
    name: string;
    message: string;
    stack?: string | undefined;
  } | undefined;
}

/**
 * Log level priority for filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger interface for structured logging
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

/**
 * Create a structured log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return entry;
}

/**
 * Format log entry for output
 */
function formatLogEntry(entry: LogEntry): string {
  const config = getConfig();

  if (config.env === 'production') {
    // JSON format for production (easier to parse)
    return JSON.stringify(entry);
  }

  // Human-readable format for development
  const levelStr = entry.level.toUpperCase().padEnd(5);
  let output = `[${entry.timestamp}] ${levelStr} ${entry.message}`;

  if (entry.context) {
    output += ` ${JSON.stringify(entry.context)}`;
  }

  if (entry.error) {
    output += `\n  Error: ${entry.error.name}: ${entry.error.message}`;
    if (entry.error.stack) {
      output += `\n  ${entry.error.stack}`;
    }
  }

  return output;
}

/**
 * Check if a log level should be output based on configured level
 */
function shouldLog(level: LogLevel): boolean {
  const config = getConfig();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[config.logging.level];
}

/**
 * Output a log entry
 */
function outputLog(entry: LogEntry): void {
  const formatted = formatLogEntry(entry);

  switch (entry.level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

/**
 * Create a logger instance with optional base context
 */
function createLoggerInstance(baseContext: Record<string, unknown> = {}): Logger {
  const mergeContext = (additionalContext?: Record<string, unknown>): Record<string, unknown> => {
    if (!additionalContext) return baseContext;
    return { ...baseContext, ...additionalContext };
  };

  return {
    debug(message: string, context?: Record<string, unknown>): void {
      if (shouldLog('debug')) {
        outputLog(createLogEntry('debug', message, mergeContext(context)));
      }
    },

    info(message: string, context?: Record<string, unknown>): void {
      if (shouldLog('info')) {
        outputLog(createLogEntry('info', message, mergeContext(context)));
      }
    },

    warn(message: string, context?: Record<string, unknown>): void {
      if (shouldLog('warn')) {
        outputLog(createLogEntry('warn', message, mergeContext(context)));
      }
    },

    error(message: string, error?: Error, context?: Record<string, unknown>): void {
      if (shouldLog('error')) {
        outputLog(createLogEntry('error', message, mergeContext(context), error));
      }
    },

    child(context: Record<string, unknown>): Logger {
      return createLoggerInstance({ ...baseContext, ...context });
    },
  };
}

/**
 * Default logger instance
 */
export const logger = createLoggerInstance();

/**
 * Create a named logger with component context
 */
export function createLogger(component: string): Logger {
  return createLoggerInstance({ component });
}
