# Participant Orchestrator Plugin

OpenClaw native plugin for participant-centric food-ordering workflow orchestration.

## Overview

This plugin acts as a **thin orchestration layer** for managing participant interactions across messaging channels (Telegram, WhatsApp). It does **not** own business logic—that belongs to external services.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Platform                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐    ┌─────────────────────────────────────────┐    │
│  │Telegram │───▶│                                         │    │
│  └─────────┘    │     participant-orchestrator plugin     │    │
│                 │                                         │    │
│  ┌─────────┐    │  ┌──────────┐  ┌────────────────────┐  │    │
│  │WhatsApp │───▶│  │ Message  │  │   Registration     │  │    │
│  └─────────┘    │  │ Router   │─▶│   Service          │  │    │
│                 │  └──────────┘  └────────────────────┘  │    │
│                 │        │                │              │    │
│                 │        ▼                ▼              │    │
│                 │  ┌──────────┐  ┌────────────────────┐  │    │
│                 │  │ Workflow │  │ Registration       │  │    │
│                 │  │ Handler  │  │ Verifier           │  │    │
│                 │  └──────────┘  └────────────────────┘  │    │
│                 │        │                │              │    │
│                 │        ▼                ▼              │    │
│                 │  ┌──────────┐  ┌────────────────────┐  │    │
│                 │  │  Reply   │  │ Participant        │  │    │
│                 │  │ Service  │  │ Mapping Store      │  │    │
│                 │  └──────────┘  └────────────────────┘  │    │
│                 │                                         │    │
│                 └─────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### External Services (Future Integration)

| Service | Responsibility |
|---------|----------------|
| Intelligence Service | Intent classification, context understanding |
| Inference Service | LLM inference for generating responses |
| Delivery Service | Order delivery coordination |

## Registration Flow

### Overview

Users must register their MOI account before using the service. Registration maps a channel identity (e.g., Telegram user ID) to a MOI account.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  User sends: "Order pizza"                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Check if        │
                    │ registered?     │
                    └─────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │ NO                            │ YES
              ▼                               ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│ Reply:                  │    │ Continue to workflow    │
│ "Please register..."    │    │ (placeholder for now)   │
└─────────────────────────┘    └─────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│  User sends: /register {"accountId":"...", ...}                 │
└─────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│ Parse registration      │
│ payload                 │
└─────────────────────────┘
              │
              ▼
┌─────────────────────────┐
│ Verify signature        │
│ (pluggable verifier)    │
└─────────────────────────┘
              │
       ┌──────┴──────┐
       │             │
    VALID        INVALID
       │             │
       ▼             ▼
┌─────────────┐  ┌─────────────┐
│ Store       │  │ Reply:      │
│ mapping     │  │ "Failed..." │
└─────────────┘  └─────────────┘
       │
       ▼
┌─────────────────────────┐
│ Reply:                  │
│ "Registration           │
│  successful."           │
└─────────────────────────┘
```

### Registration Command Format

Users send the `/register` command with a JSON payload:

```
/register {"accountId":"moi_123","publicKey":"pk_abc","signature":"sig_xyz","message":"register:telegram_user_456"}
```

#### Payload Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountId` | string | Yes | MOI account identifier |
| `publicKey` | string | Yes | Public key for signature verification |
| `signature` | string | Yes | Cryptographic signature |
| `message` | string | Yes | Signed message (format: `register:<channel>_<userId>`) |

#### Message Format

The `message` field must follow this format:
```
register:<channel>_<externalUserId>
```

Examples:
- Telegram: `register:telegram_123456789`
- WhatsApp: `register:whatsapp_+1234567890`

### Response Messages

| Scenario | Response |
|----------|----------|
| Unregistered user (normal message) | "You are not registered yet. Please register your MOI account..." |
| Successful registration | "Registration successful. Your account is now linked." |
| Already registered | "You are already registered." |
| Invalid payload | "Registration failed. Please check your payload and try again." |
| Verification failed | "Registration failed. [error details]" |

## Mock Verification

For development and testing, the plugin uses a **MockRegistrationVerifier** that validates payload structure without real cryptographic verification.

### Mock Verifier Configuration

```typescript
import { createPlugin } from '@openclaw/participant-orchestrator';

const plugin = createPlugin({
  mockVerifierConfig: {
    // Accept all well-formed payloads (default: true)
    acceptAllValid: true,

    // Only accept specific test signatures
    acceptedTestSignatures: ['test_sig_1', 'test_sig_2'],

    // Reject specific account IDs (for testing)
    rejectedAccountIds: ['banned_account'],

    // Simulate verification delay
    simulatedDelayMs: 100,
  },
});
```

### Mock Verifier Behavior

1. **acceptAllValid: true** (default)
   - Accepts any payload where `message` matches `register:<channel>_<userId>`
   - No signature verification

2. **acceptedTestSignatures**
   - Only accepts signatures in this list
   - Useful for testing specific scenarios

3. **rejectedAccountIds**
   - Rejects accounts in this list
   - Useful for testing error handling

### Custom Verifier

Replace the mock verifier with a real implementation:

```typescript
import { createPlugin, type RegistrationVerifier } from '@openclaw/participant-orchestrator';

class ExternalVerifier implements RegistrationVerifier {
  async verify(payload, context) {
    // Call external service for verification
    const response = await fetch('https://auth.example.com/verify', {
      method: 'POST',
      body: JSON.stringify({ payload, context }),
    });

    const result = await response.json();
    return {
      valid: result.verified,
      error: result.error,
    };
  }
}

const plugin = createPlugin({
  registrationVerifier: new ExternalVerifier(),
});
```

## OpenClaw Integration

### Method 1: Install as OpenClaw Plugin (Recommended)

**Step 1: Install the plugin**

```bash
# From npm (when published)
openclaw plugins install @openclaw/participant-orchestrator

# Or from local directory
openclaw plugins install ./participant-orchestrator
```

**Step 2: Enable the plugin**

```bash
openclaw plugins enable participant-orchestrator
```

**Step 3: Configure in `openclaw.json`**

```json5
{
  "plugins": {
    "enabled": true,
    "entries": {
      "participant-orchestrator": {
        "enabled": true,
        "config": {
          "enableTelegram": true,
          "enableWhatsApp": false
        }
      }
    }
  }
}
```

**Step 4: Restart OpenClaw Gateway**

```bash
openclaw gateway restart
```

### Method 2: Programmatic Integration

```typescript
import { createPlugin } from '@openclaw/participant-orchestrator';

const plugin = createPlugin();

// Handle incoming message
const result = await plugin.handleMessage({
  messageId: 'msg_123',
  channel: 'telegram',
  channelMeta: { chatId: 12345, chatType: 'private', messageId: 100 },
  externalUserId: 'user_456',
  text: '/register {"accountId":"moi_123","publicKey":"pk","signature":"sig","message":"register:telegram_user_456"}',
  timestamp: new Date(),
});

console.log(result);
// { success: true, action: 'registered', moiAccountId: 'moi_123' }
```

## Configuration

### Environment Variables

```bash
# Plugin Configuration
PLUGIN_NAME=participant-orchestrator
PLUGIN_ENV=development

# Logging
LOG_LEVEL=debug

# Feature Flags
ENABLE_TELEGRAM=true
ENABLE_WHATSAPP=false
```

## Project Structure

```
participant-orchestrator/
├── src/
│   ├── index.ts                    # Plugin entrypoint
│   ├── openclaw-integration.ts     # OpenClaw adapter
│   ├── config/
│   │   └── index.ts                # Configuration
│   ├── types/
│   │   ├── channel.ts              # Channel types
│   │   ├── message.ts              # Message types
│   │   ├── participant.ts          # Participant types
│   │   └── registration.ts         # Registration types
│   ├── services/
│   │   ├── message-router.ts       # Routes messages
│   │   ├── registration-parser.ts  # Parses /register command
│   │   ├── registration-verifier.ts # Verification interface + mock
│   │   ├── registration-service.ts # Registration orchestration
│   │   ├── registration-checker.ts # Checks if registered
│   │   └── reply-service.ts        # Sends replies
│   ├── handlers/
│   │   └── workflow-handler.ts     # Main workflow logic
│   └── stores/
│       └── in-memory-store.ts      # In-memory storage
└── tests/
    └── *.test.ts                   # Unit tests
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint
```

## API Reference

### Plugin Methods

```typescript
// Create plugin instance
const plugin = createPlugin(options?: PluginOptions);

// Handle inbound message
const result = await plugin.handleMessage(message: InboundMessage);

// Get participant store
const store = plugin.getParticipantStore();

// Get registration service
const service = plugin.getRegistrationService();

// Health check
const health = await plugin.healthCheck();
```

### Message Processing Result

```typescript
interface ExtendedMessageProcessingResult {
  success: boolean;
  messageId: string;
  action: 'registration_required' | 'workflow_continue' | 'registered' | 'already_registered' | 'registration_failed' | 'error';
  moiAccountId?: string;
  error?: string;
}
```

## Testing Registration

### Test Registration via CLI

```bash
# Manual test with curl (if HTTP endpoint exposed)
curl -X POST http://localhost:8080/plugins/participant-orchestrator/test \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "telegram",
    "userId": "test_user",
    "text": "/register {\"accountId\":\"moi_test\",\"publicKey\":\"pk\",\"signature\":\"sig\",\"message\":\"register:telegram_test_user\"}"
  }'
```

### Test Registration in Code

```typescript
import { createPlugin, ChannelType } from '@openclaw/participant-orchestrator';

const plugin = createPlugin();

// Test registration
const result = await plugin.handleMessage({
  messageId: 'test_msg',
  channel: ChannelType.TELEGRAM,
  channelMeta: { chatId: 123, chatType: 'private', messageId: 1 },
  externalUserId: 'test_user',
  text: '/register {"accountId":"moi_test","publicKey":"pk","signature":"sig","message":"register:telegram_test_user"}',
  timestamp: new Date(),
});

console.log(result.action); // 'registered'

// Verify registration
const lookup = await plugin.getParticipantStore().lookup({
  channel: ChannelType.TELEGRAM,
  externalUserId: 'test_user',
});
console.log(lookup.found); // true
console.log(lookup.mapping?.moiAccountId); // 'moi_test'
```

## Session Orchestration

### Overview

Session orchestration manages permission sessions between participants and the plugin. Before executing workflows that require data access, the plugin must validate or create a session with appropriate permissions.

**Important Architecture Rule:** The plugin is only the orchestrator. It does NOT own session validity rules. The Intelligence Service is the source of truth for validating sessions.

### Session Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  User sends: "Order some food for dinner"                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Classify        │
                    │ Request         │
                    └─────────────────┘
                              │
                    Intent: food_ordering
                    Categories: [FOOD, HEALTH]
                    Scopes: [preferences.food.read, health.read]
                              │
                              ▼
                    ┌─────────────────┐
                    │ Get candidate   │
                    │ sessions from   │
                    │ local store     │
                    └─────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │ Has candidates                │ No candidates
              ▼                               ▼
    ┌─────────────────┐            ┌─────────────────┐
    │ Validate each   │            │ Create session  │
    │ via Intelligence│            │ request         │
    │ Service         │            └─────────────────┘
    └─────────────────┘                     │
              │                             │
       ┌──────┴──────┐                      ▼
       │             │            ┌─────────────────┐
    VALID        ALL INVALID      │ Call            │
       │             │            │ /v1/writes/     │
       ▼             ▼            │ prepare         │
┌─────────────┐  ┌─────────────┐  └─────────────────┘
│ Use valid   │  │ Create      │            │
│ session     │  │ session     │            ▼
│             │  │ request     │  ┌─────────────────┐
│ Status:     │  └─────────────┘  │ Reply with      │
│ SESSION_    │         │         │ signing         │
│ ACTIVE      │         ▼         │ instructions    │
└─────────────┘  ┌─────────────┐  └─────────────────┘
                 │ Wait for    │
                 │ signature   │
                 │             │
                 │ Status:     │
                 │ WAITING_FOR_│
                 │ SIGNATURE   │
                 └─────────────┘
```

### Workflow States

| Status | Description |
|--------|-------------|
| `NEW` | Workflow just created |
| `CHECKING_SESSIONS` | Validating candidate sessions |
| `SESSION_ACTIVE` | Valid session found and selected |
| `SESSION_REQUIRED` | No valid session, creation needed |
| `WAITING_FOR_SIGNATURE` | Session request prepared, awaiting wallet signature |
| `WAITING_FOR_CONFIRMATION` | Transaction submitted, awaiting blockchain confirmation |
| `READY_FOR_INFERENCE` | Session confirmed, ready for next phase |
| `FAILED` | Workflow failed |

### Local Stores

The plugin maintains local stores for efficiency. **Important:** Session IDs in the local store are candidates only. Every candidate must be validated via the Intelligence Service.

#### Session Store
```typescript
interface SessionRecord {
  participantId: string;
  sessionIds: string[];  // Candidate session IDs
  createdAt: Date;
  updatedAt: Date;
}
```

#### Workflow Store
```typescript
interface WorkflowRecord {
  workflowId: string;
  requestId: string;
  participantId: string;
  channel: 'telegram' | 'whatsapp';
  externalUserId: string;
  originalMessage: string;
  intent: string;
  requiredCategories: string[];
  requiredScopes: string[];
  sessionId?: string;
  txHash?: string;
  status: WorkflowStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

### Request Classification

The plugin uses deterministic classification for v1 (no LLM):

```typescript
// Input: "Order some food for dinner"
// Output:
{
  intent: 'food_ordering',
  requiredCategories: ['FOOD', 'HEALTH'],
  requiredScopes: ['preferences.food.read', 'health.read'],
  confidence: 0.75
}
```

Keywords that trigger food ordering intent: order, food, eat, dinner, lunch, breakfast, hungry, pizza, burger, restaurant, delivery, meal, etc.

### Resume Command

After signing a session request in your wallet, use the `/resume` command to continue:

```
/resume {"workflowId":"wf_123","sessionId":"sess_456","txHash":"0xtx789"}
```

#### Resume Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  User sends: /resume {"workflowId":"...","sessionId":"...","txHash":"..."}
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Get workflow    │
                    │ by ID           │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Check tx status │
                    │ via Intelligence│
                    │ Service         │
                    └─────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
          CONFIRMED       PENDING         FAILED
              │               │               │
              ▼               ▼               ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Add session to  │  │ Reply:          │  │ Reply:          │
│ local store     │  │ "Still pending" │  │ "Failed"        │
│                 │  │                 │  │                 │
│ Status:         │  │ Status:         │  │ Status:         │
│ READY_FOR_      │  │ WAITING_FOR_    │  │ FAILED          │
│ INFERENCE       │  │ CONFIRMATION    │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Intelligence Service Integration

The plugin communicates with the Intelligence Service for:

1. **Session Validation** - `POST /v1/sessions/validate`
2. **Write Preparation** - `POST /v1/writes/prepare`
3. **Write Status** - `GET /v1/writes/status/:txHash`

#### Using Mock Intelligence Client (Development)

```typescript
import { createPlugin } from '@openclaw/participant-orchestrator';

const plugin = createPlugin({
  sessionOrchestration: {
    agentId: 'openclaw_telegram_bot',
    mockIntelligenceConfig: {
      // Pre-configure valid sessions for testing
      validSessions: new Map([
        ['participant_001', ['sess_test_123']],
      ]),
      // Auto-approve session creation
      autoApproveSessionCreation: true,
    },
  },
});
```

#### Using Real Intelligence Client (Production)

```typescript
import { createPlugin, createIntelligenceClient } from '@openclaw/participant-orchestrator';

const intelligenceClient = createIntelligenceClient({
  baseUrl: 'https://intelligence.moi.network',
  agentId: 'openclaw_telegram_bot',
  apiKey: process.env.INTELLIGENCE_API_KEY,
});

const plugin = createPlugin({
  sessionOrchestration: {
    agentId: 'openclaw_telegram_bot',
    intelligenceClient,
  },
});
```

### Enabling Session Orchestration

```typescript
const plugin = createPlugin({
  sessionOrchestration: {
    // Required: Agent ID for this plugin instance
    agentId: 'openclaw_telegram_bot',

    // Optional: Custom configuration
    defaultRequestedUses: 5,    // Uses per session
    defaultTtlSeconds: 1800,    // Session TTL (30 min)
    defaultKeyId: 0,            // Key ID for signing
  },
});

// Check if session orchestration is enabled
console.log(plugin.isSessionOrchestrationEnabled()); // true
```

### Testing Session Orchestration

```typescript
import {
  createPlugin,
  ChannelType,
  resetSessionStore,
  resetWorkflowStore,
} from '@openclaw/participant-orchestrator';

// Reset stores before tests
resetSessionStore();
resetWorkflowStore();

const plugin = createPlugin({
  sessionOrchestration: {
    agentId: 'test_agent',
  },
});

// Register a user first
await plugin.handleMessage({
  messageId: 'msg_1',
  channel: ChannelType.TELEGRAM,
  channelMeta: { chatId: 123, chatType: 'private', messageId: 1 },
  externalUserId: 'user_123',
  text: '/register {"accountId":"moi_test","publicKey":"pk","signature":"sig","message":"register:telegram_user_123"}',
  timestamp: new Date(),
});

// Now test session orchestration
const result = await plugin.handleMessage({
  messageId: 'msg_2',
  channel: ChannelType.TELEGRAM,
  channelMeta: { chatId: 123, chatType: 'private', messageId: 2 },
  externalUserId: 'user_123',
  text: 'Order some food for dinner',
  timestamp: new Date(),
});

console.log(result.action); // 'session_creation_required'
console.log(result.workflowId); // 'wf_...'

// Test resume
const resumeResult = await plugin.handleMessage({
  messageId: 'msg_3',
  channel: ChannelType.TELEGRAM,
  channelMeta: { chatId: 123, chatType: 'private', messageId: 3 },
  externalUserId: 'user_123',
  text: `/resume {"workflowId":"${result.workflowId}","sessionId":"${result.sessionId}","txHash":"0xtx123"}`,
  timestamp: new Date(),
});

console.log(resumeResult.action); // 'session_resumed' (mock auto-confirms)
```

## Roadmap

### Phase 1: Basic Registration ✅
- Registration command parsing
- Mock signature verification
- Participant mapping storage
- Registration flow responses

### Phase 2: Session Orchestration ✅
- Request classification (deterministic)
- Session validation via Intelligence Service
- Session creation via writes/prepare
- Resume flow for transaction confirmation
- Local session and workflow stores

### Phase 3: Inference Integration
- Intelligence Service full integration
- Real cryptographic verification
- Session-based inference calls

### Phase 4: Order Flow
- Inference Service integration
- Order state machine
- Delivery Service coordination

## License

MIT
