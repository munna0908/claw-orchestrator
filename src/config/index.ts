import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

/**
 * Log levels supported by the plugin
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Plugin environment
 */
export type Environment = 'development' | 'staging' | 'production';

/**
 * Plugin configuration interface
 */
export interface PluginConfig {
  /** Plugin name */
  name: string;

  /** Current environment */
  env: Environment;

  /** Logging configuration */
  logging: {
    level: LogLevel;
  };

  /** OpenClaw connection settings */
  openclaw: {
    host: string;
    port: number;
  };

  /** Channel feature flags */
  channels: {
    telegram: boolean;
    whatsapp: boolean;
  };
}

/**
 * Parse environment variable as boolean
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Parse environment variable as integer
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Validate and parse log level
 */
function parseLogLevel(value: string | undefined): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (value && validLevels.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return 'info';
}

/**
 * Validate and parse environment
 */
function parseEnvironment(value: string | undefined): Environment {
  const validEnvs: Environment[] = ['development', 'staging', 'production'];
  if (value && validEnvs.includes(value as Environment)) {
    return value as Environment;
  }
  return 'development';
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): PluginConfig {
  return {
    name: process.env['PLUGIN_NAME'] ?? 'participant-orchestrator',
    env: parseEnvironment(process.env['PLUGIN_ENV']),
    logging: {
      level: parseLogLevel(process.env['LOG_LEVEL']),
    },
    openclaw: {
      host: process.env['OPENCLAW_HOST'] ?? 'localhost',
      port: parseInteger(process.env['OPENCLAW_PORT'], 8080),
    },
    channels: {
      telegram: parseBoolean(process.env['ENABLE_TELEGRAM'], true),
      whatsapp: parseBoolean(process.env['ENABLE_WHATSAPP'], false),
    },
  };
}

/**
 * Singleton configuration instance
 */
let configInstance: PluginConfig | null = null;

/**
 * Get the plugin configuration (singleton)
 */
export function getConfig(): PluginConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
