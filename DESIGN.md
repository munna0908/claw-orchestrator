# Participant Orchestrator - Design Document

## 1. System Overview

The Participant Orchestrator is an OpenClaw plugin that acts as a **thin orchestration layer** for participant-centric workflows. It handles:

1. **User Registration** - Maps channel identities (Telegram/WhatsApp) to MOI accounts
2. **Session Orchestration** - Validates/creates permission sessions with Intelligence Service
3. **Workflow Management** - Tracks workflow state through the session lifecycle

### Architecture Principle

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PLUGIN BOUNDARY                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              participant-orchestrator                        │   │
│  │                                                              │   │
│  │   • Orchestrates flows                                       │   │
│  │   • Does NOT own business logic                              │   │
│  │   • Does NOT own cryptographic truth                         │   │
│  │   • Delegates validation to external services                │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Intelligence    │  │   Inference      │  │    Delivery      │  │
│  │  Service         │  │   Service        │  │    Service       │  │
│  │                  │  │                  │  │                  │  │
│  │  • Session       │  │  • LLM inference │  │  • Order         │  │
│  │    validation    │  │  • Response gen  │  │    coordination  │  │
│  │  • Write prep    │  │                  │  │                  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Component Diagram

```
src/
├── index.ts                          # Plugin entry point & wiring
├── openclaw-integration.ts           # OpenClaw platform adapter
│
├── handlers/
│   └── workflow-handler.ts           # Main message routing logic
│
├── services/
│   ├── message-router.ts             # Channel validation & routing
│   ├── registration-checker.ts       # Check if user is registered
│   ├── registration-parser.ts        # Parse /register command
│   ├── registration-verifier.ts      # Verify registration signatures
│   ├── registration-service.ts       # Orchestrate registration flow
│   ├── request-classifier.ts         # Classify user intent
│   ├── intelligence-client.ts        # Intelligence Service API client
│   ├── session-orchestrator.ts       # Session validation/creation
│   ├── resume-handler.ts             # Handle /resume command
│   └── reply-service.ts              # Send replies to users
│
├── stores/
│   ├── in-memory-store.ts            # Participant mapping store
│   ├── session-store.ts              # Session ID store
│   └── workflow-store.ts             # Workflow state store
│
└── types/
    ├── channel.ts                    # Channel types
    ├── message.ts                    # Message types
    ├── participant.ts                # Participant mapping types
    ├── registration.ts               # Registration types
    ├── workflow.ts                   # Workflow & classification types
    ├── session.ts                    # Session result types
    └── intelligence.ts               # Intelligence API types
```

### 2.2 Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| **ParticipantOrchestratorPlugin** | `index.ts:60-250` | Main plugin class, wires all components |
| **MessageRouter** | `message-router.ts:20-137` | Validates messages, checks channel enabled |
| **WorkflowHandler** | `workflow-handler.ts:44-350` | Routes to registration, resume, or session flow |
| **RegistrationService** | `registration-service.ts:27-173` | Orchestrates full registration flow |
| **RequestClassifier** | `request-classifier.ts:40-100` | Classifies intent from message text |
| **SessionOrchestrator** | `session-orchestrator.ts:50-250` | Validates/creates sessions |
| **ResumeHandler** | `resume-handler.ts:100-200` | Checks tx status, activates sessions |
| **IntelligenceClient** | `intelligence-client.ts:40-180` | HTTP client for Intelligence Service |
| **ReplyService** | `reply-service.ts:48-320` | Sends formatted replies |

---

## 3. Data Models

### 3.1 Participant Mapping

```typescript
// src/types/participant.ts
interface ParticipantMapping {
  id: string;                    // "pm_1234567890_abc123"
  channel: 'telegram' | 'whatsapp';
  externalUserId: string;        // Telegram: "123456789", WhatsApp: "+1234567890"
  moiAccountId: string;          // "moi_abc123"
  createdAt: Date;
  updatedAt: Date;
}
```

**Storage:** `src/stores/in-memory-store.ts`

### 3.2 Workflow Record

```typescript
// src/types/workflow.ts
interface WorkflowRecord {
  workflowId: string;            // "wf_1234567890_abc123"
  requestId: string;             // "req_1234567890_xyz789"
  participantId: string;         // MOI account ID
  channel: 'telegram' | 'whatsapp';
  externalUserId: string;
  originalMessage: string;       // "Order some food for dinner"
  intent: 'food_ordering' | 'unknown';
  requiredCategories: string[];  // ["FOOD", "HEALTH"]
  requiredScopes: string[];      // ["preferences.food.read", "health.read"]
  sessionId?: string;            // Selected or created session
  txHash?: string;               // Transaction hash for session creation
  status: WorkflowStatus;
  signingPayload?: object;       // From prepare response
  createdAt: Date;
  updatedAt: Date;
}
```

**Storage:** `src/stores/workflow-store.ts`

### 3.3 Session Record

```typescript
// src/types/session.ts
interface SessionRecord {
  participantId: string;
  sessionIds: string[];          // Candidate session IDs (NOT validated)
  createdAt: Date;
  updatedAt: Date;
}
```

**Storage:** `src/stores/session-store.ts`

---

## 4. End-to-End Flows

### 4.1 Flow 1: Unregistered User

```
User                    Plugin                         Store
  │                        │                             │
  │  "Order some food"     │                             │
  │───────────────────────▶│                             │
  │                        │                             │
  │                        │  lookup(channel, userId)    │
  │                        │────────────────────────────▶│
  │                        │                             │
  │                        │  { found: false }           │
  │                        │◀────────────────────────────│
  │                        │                             │
  │  "Please register..."  │                             │
  │◀───────────────────────│                             │
  │                        │                             │
```

**Implementation Path:**

1. `index.ts:210` → `handleMessage()`
2. `message-router.ts:65` → `route()`
3. `workflow-handler.ts:54` → `handle()`
4. `workflow-handler.ts:68-72` → Check registration
5. `registration-checker.ts:30-50` → `check()`
6. `workflow-handler.ts:73-92` → Not registered, send prompt
7. `reply-service.ts:109-122` → `sendRegistrationRequired()`

**Return Value:**
```typescript
{
  success: true,
  messageId: "msg_123",
  action: "registration_required"
}
```

---

### 4.2 Flow 2: Registration

```
User                    Plugin                    Verifier           Store
  │                        │                         │                 │
  │  /register {...}       │                         │                 │
  │───────────────────────▶│                         │                 │
  │                        │                         │                 │
  │                        │  parse command          │                 │
  │                        │─────────┐               │                 │
  │                        │         │               │                 │
  │                        │◀────────┘               │                 │
  │                        │                         │                 │
  │                        │  verify(payload)        │                 │
  │                        │────────────────────────▶│                 │
  │                        │                         │                 │
  │                        │  { valid: true }        │                 │
  │                        │◀────────────────────────│                 │
  │                        │                         │                 │
  │                        │                    create(mapping)        │
  │                        │──────────────────────────────────────────▶│
  │                        │                                           │
  │                        │                    { id: "pm_..." }       │
  │                        │◀──────────────────────────────────────────│
  │                        │                         │                 │
  │  "Registration         │                         │                 │
  │   successful."         │                         │                 │
  │◀───────────────────────│                         │                 │
```

**Implementation Path:**

1. `workflow-handler.ts:62-65` → Detect `/register` command
2. `workflow-handler.ts:205-270` → `handleRegistrationCommand()`
3. `registration-service.ts:47-145` → `processRegistration()`
   - `registration-service.ts:57-75` → Check if already registered
   - `registration-parser.ts:85-165` → Parse command
   - `registration-verifier.ts:64-133` → Verify signature
   - `in-memory-store.ts:40-60` → Store mapping
4. `reply-service.ts:163-178` → `sendRegistrationSuccess()`

**Command Format:**
```
/register {"accountId":"moi_123","publicKey":"pk_abc","signature":"sig_xyz","message":"register:telegram_user_456"}
```

**Return Value:**
```typescript
{
  success: true,
  messageId: "msg_123",
  action: "registered",
  moiAccountId: "moi_123"
}
```

---

### 4.3 Flow 3: Session Found (Happy Path)

```
User                Plugin              SessionStore    IntelligenceService
  │                    │                      │                  │
  │ "Order food"       │                      │                  │
  │───────────────────▶│                      │                  │
  │                    │                      │                  │
  │                    │  classify()          │                  │
  │                    │────┐                 │                  │
  │                    │    │ intent:         │                  │
  │                    │◀───┘ food_ordering   │                  │
  │                    │                      │                  │
  │                    │  getSessionIds()     │                  │
  │                    │─────────────────────▶│                  │
  │                    │                      │                  │
  │                    │  ["sess_123"]        │                  │
  │                    │◀─────────────────────│                  │
  │                    │                      │                  │
  │                    │        POST /v1/sessions/validate       │
  │                    │─────────────────────────────────────────▶│
  │                    │                      │                  │
  │                    │        { valid: true }                  │
  │                    │◀─────────────────────────────────────────│
  │                    │                      │                  │
  │ "Permissions       │                      │                  │
  │  available.        │                      │                  │
  │  Continuing."      │                      │                  │
  │◀───────────────────│                      │                  │
```

**Implementation Path:**

1. `workflow-handler.ts:95-115` → Registered user, start session orchestration
2. `request-classifier.ts:50-70` → `classify()`
3. `workflow-handler.ts:130-145` → Check intent is not unknown
4. `session-orchestrator.ts:90-180` → `orchestrate()`
   - `workflow-store.ts:40-70` → Create workflow record
   - `session-store.ts:40-55` → Get candidate session IDs
   - `session-orchestrator.ts:140-175` → `validateCandidateSessions()`
   - `intelligence-client.ts:70-100` → `validateSession()`
5. `workflow-handler.ts:160-175` → Session found
6. `reply-service.ts:225-240` → `sendSessionActive()`

**Return Value:**
```typescript
{
  success: true,
  messageId: "msg_123",
  action: "session_found",
  moiAccountId: "moi_123",
  workflowId: "wf_1234567890_abc",
  sessionId: "sess_123"
}
```

---

### 4.4 Flow 4: Session Creation Required

```
User                Plugin              SessionStore    IntelligenceService
  │                    │                      │                  │
  │ "Order food"       │                      │                  │
  │───────────────────▶│                      │                  │
  │                    │                      │                  │
  │                    │  getSessionIds()     │                  │
  │                    │─────────────────────▶│                  │
  │                    │                      │                  │
  │                    │  [] (empty)          │                  │
  │                    │◀─────────────────────│                  │
  │                    │                      │                  │
  │                    │        POST /v1/writes/prepare          │
  │                    │─────────────────────────────────────────▶│
  │                    │                      │                  │
  │                    │        { success: true,                 │
  │                    │          signablePayload: "..." }       │
  │                    │◀─────────────────────────────────────────│
  │                    │                      │                  │
  │ "Please sign the   │                      │                  │
  │  session request   │                      │                  │
  │  in your wallet.   │                      │                  │
  │                    │                      │                  │
  │  /resume {...}"    │                      │                  │
  │◀───────────────────│                      │                  │
```

**Implementation Path:**

1. `session-orchestrator.ts:110-125` → No candidates, skip to creation
2. `session-orchestrator.ts:185-250` → `createSessionRequest()`
   - Generate new session ID
   - `intelligence-client.ts:100-130` → `prepareWrite()`
   - `workflow-store.ts:75-100` → Update workflow status
3. `session-orchestrator.ts:240-260` → Generate signing instructions
4. `reply-service.ts:245-260` → `sendSessionCreationRequired()`

**Prepare Write Request:**
```typescript
{
  requestId: "req_1234567890_abc",
  participantId: "moi_123",
  keyId: 0,
  action: "create_session_request",
  params: {
    sessionId: "sess_new_456",
    agentId: "openclaw_telegram_bot",
    purpose: "food_ordering",
    approvedCategories: ["FOOD", "HEALTH"],
    approvedScopes: ["preferences.food.read", "health.read"],
    requestedUses: 5,
    ttlSeconds: 1800
  }
}
```

**Return Value:**
```typescript
{
  success: true,
  messageId: "msg_123",
  action: "session_creation_required",
  moiAccountId: "moi_123",
  workflowId: "wf_1234567890_abc",
  sessionId: "sess_new_456"
}
```

---

### 4.5 Flow 5: Resume (Transaction Confirmed)

```
User                Plugin              WorkflowStore   IntelligenceService  SessionStore
  │                    │                      │                  │                │
  │ /resume {...}      │                      │                  │                │
  │───────────────────▶│                      │                  │                │
  │                    │                      │                  │                │
  │                    │  get(workflowId)     │                  │                │
  │                    │─────────────────────▶│                  │                │
  │                    │                      │                  │                │
  │                    │  workflow            │                  │                │
  │                    │◀─────────────────────│                  │                │
  │                    │                      │                  │                │
  │                    │         GET /v1/writes/status/:txHash   │                │
  │                    │─────────────────────────────────────────▶│                │
  │                    │                      │                  │                │
  │                    │         { status: "confirmed" }         │                │
  │                    │◀─────────────────────────────────────────│                │
  │                    │                      │                  │                │
  │                    │  update(READY_FOR_INFERENCE)            │                │
  │                    │─────────────────────▶│                  │                │
  │                    │                      │                  │                │
  │                    │                                    addSessionId()       │
  │                    │─────────────────────────────────────────────────────────▶│
  │                    │                      │                  │                │
  │ "Session active.   │                      │                  │                │
  │  Continuing."      │                      │                  │                │
  │◀───────────────────│                      │                  │                │
```

**Implementation Path:**

1. `workflow-handler.ts:67-70` → Detect `/resume` command
2. `workflow-handler.ts:280-350` → `handleResumeCommand()`
3. `resume-handler.ts:50-100` → `parseResumeCommand()`
4. `resume-handler.ts:120-180` → `handleResume()`
   - `workflow-store.ts:80-95` → Get workflow
   - `intelligence-client.ts:130-150` → `getWriteStatus()`
   - `resume-handler.ts:185-220` → `handleConfirmed()`
   - `workflow-store.ts:100-120` → Update status
   - `session-store.ts:60-80` → Add session ID
5. `reply-service.ts:270-285` → `sendSessionResumed()`

**Resume Command Format:**
```
/resume {"workflowId":"wf_123","sessionId":"sess_456","txHash":"0xtx789"}
```

**Return Value:**
```typescript
{
  success: true,
  messageId: "msg_123",
  action: "session_resumed",
  moiAccountId: "moi_123",
  workflowId: "wf_123",
  sessionId: "sess_456"
}
```

---

## 5. State Machine

### 5.1 Workflow Status Transitions

```
                                    ┌─────────┐
                                    │   NEW   │
                                    └────┬────┘
                                         │
                                         ▼
                              ┌───────────────────┐
                              │ CHECKING_SESSIONS │
                              └─────────┬─────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
           ┌────────────────┐  ┌────────────────┐  ┌────────────┐
           │ SESSION_ACTIVE │  │SESSION_REQUIRED│  │   FAILED   │
           └────────────────┘  └───────┬────────┘  └────────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │ WAITING_FOR_        │
                            │ SIGNATURE           │
                            └──────────┬──────────┘
                                       │
                                       │ /resume
                                       ▼
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
           ┌────────────────┐ ┌────────────────┐ ┌────────────┐
           │ SESSION_ACTIVE │ │ WAITING_FOR_   │ │   FAILED   │
           └───────┬────────┘ │ CONFIRMATION   │ └────────────┘
                   │          └────────────────┘
                   ▼
          ┌─────────────────┐
          │ READY_FOR_      │
          │ INFERENCE       │
          └─────────────────┘
```

### 5.2 Status Definitions

| Status | Set By | Meaning |
|--------|--------|---------|
| `NEW` | `workflow-store.ts:50` | Workflow created |
| `CHECKING_SESSIONS` | `session-orchestrator.ts:100` | Validating candidate sessions |
| `SESSION_ACTIVE` | `session-orchestrator.ts:145` | Valid session found |
| `SESSION_REQUIRED` | `session-orchestrator.ts:190` | No valid session, need to create |
| `WAITING_FOR_SIGNATURE` | `session-orchestrator.ts:225` | Prepare succeeded, awaiting wallet |
| `WAITING_FOR_CONFIRMATION` | `resume-handler.ts:180` | Tx submitted, awaiting confirmation |
| `READY_FOR_INFERENCE` | `resume-handler.ts:165` | Session confirmed, ready for next phase |
| `FAILED` | Various | Workflow failed |

---

## 6. Intelligence Service API Contracts

### 6.1 Validate Session

**Endpoint:** `POST /v1/sessions/validate`

**Request:**
```typescript
interface ValidateSessionRequest {
  participantId: string;      // "moi_123"
  agentId: string;            // "openclaw_telegram_bot"
  sessionId: string;          // "sess_456"
  requiredCategories: string[]; // ["FOOD", "HEALTH"]
  requiredScopes: string[];   // ["preferences.food.read"]
  currentTime: number;        // Unix timestamp
}
```

**Response:**
```typescript
interface ValidateSessionResponse {
  valid: boolean;
  reason: string | null;      // "missing_scope", "expired", etc.
}
```

**Implementation:** `intelligence-client.ts:55-100`

### 6.2 Prepare Write

**Endpoint:** `POST /v1/writes/prepare`

**Request:**
```typescript
interface PrepareWriteRequest {
  requestId: string;
  participantId: string;
  keyId: number;
  action: "create_session_request";
  params: {
    sessionId: string;
    agentId: string;
    purpose: string;
    approvedCategories: string[];
    approvedScopes: string[];
    requestedUses: number;
    ttlSeconds: number;
  };
}
```

**Response:**
```typescript
interface PrepareWriteResponse {
  success: boolean;
  requestId: string;
  signablePayload?: string;
  summary?: string;
  error?: string;
}
```

**Implementation:** `intelligence-client.ts:100-130`

### 6.3 Get Write Status

**Endpoint:** `GET /v1/writes/status/:txHash`

**Response:**
```typescript
interface WriteStatusResponse {
  txHash: string;
  status: "pending" | "confirmed" | "failed";
  blockNumber?: number;
  error?: string;
  updatedAt: number;
}
```

**Implementation:** `intelligence-client.ts:130-150`

---

## 7. Configuration

### 7.1 Plugin Initialization

```typescript
// src/index.ts:183-185
const plugin = createPlugin({
  // Registration options
  mockVerifierConfig: {
    acceptAllValid: true,
    acceptedTestSignatures: ["test_sig"],
  },

  // Session orchestration options
  sessionOrchestration: {
    agentId: "openclaw_telegram_bot",       // Required
    defaultRequestedUses: 5,                 // Optional
    defaultTtlSeconds: 1800,                 // Optional
    defaultKeyId: 0,                         // Optional

    // For production: provide real client
    intelligenceClient: createIntelligenceClient({
      baseUrl: "https://intelligence.moi.network",
      agentId: "openclaw_telegram_bot",
      apiKey: process.env.INTELLIGENCE_API_KEY,
    }),
  },
});
```

### 7.2 Environment Variables

```bash
# Channel flags
ENABLE_TELEGRAM=true
ENABLE_WHATSAPP=false

# Logging
LOG_LEVEL=debug
PLUGIN_ENV=development

# Intelligence Service (production)
INTELLIGENCE_API_KEY=your_api_key
```

---

## 8. Error Handling

### 8.1 Error Categories

| Category | Handling | User Message |
|----------|----------|--------------|
| Invalid command format | Return error, log | "Invalid format..." |
| Registration failed | Return error, log | "Registration failed..." |
| Session validation failed | Continue to next candidate | (silent, try next) |
| All sessions invalid | Create new session | "Please sign..." |
| Prepare write failed | Set FAILED status | "Something went wrong..." |
| Resume tx failed | Set FAILED status | "Session approval failed..." |
| Internal error | Log, return generic error | "Sorry, something went wrong..." |

### 8.2 Error Flow Example

```typescript
// session-orchestrator.ts:200-230
try {
  const prepareResult = await this.intelligenceClient.prepareWrite(request);

  if (!prepareResult.success) {
    await this.workflowStore.update(workflowId, { status: WorkflowStatus.FAILED });
    return { success: false, action: 'error', error: prepareResult.error };
  }
  // ... continue
} catch (error) {
  logger.error('Error preparing session creation', error);
  await this.workflowStore.update(workflowId, { status: WorkflowStatus.FAILED });
  return { success: false, action: 'error', error: error.message };
}
```

---

## 9. Testing Strategy

### 9.1 Test Files

| File | Coverage |
|------|----------|
| `tests/request-classifier.test.ts` | Intent classification |
| `tests/session-orchestrator.test.ts` | Session validation/creation flows |
| `tests/resume-handler.test.ts` | Resume command parsing and handling |
| `tests/registration-*.test.ts` | Registration flows |
| `tests/plugin.test.ts` | End-to-end plugin tests |

### 9.2 Mock Strategy

All external dependencies are mockable:

```typescript
// Mock Intelligence Client
const mockClient = createMockIntelligenceClient({
  validSessions: new Map([["participant_001", ["sess_123"]]]),
  autoApproveSessionCreation: true,
});

// Mock Verifier
const mockVerifier = createMockVerifier({
  acceptAllValid: true,
});
```

---

## 10. Future Considerations

### 10.1 Not Yet Implemented

- Real cryptographic signature verification
- LLM-based intent classification
- Inference Service integration
- Delivery Service integration
- Persistent storage (database)
- Wallet deep links for signing

### 10.2 Extension Points

| Component | Interface | Purpose |
|-----------|-----------|---------|
| `RegistrationVerifier` | `registration-verifier.ts:23-32` | Swap mock for real crypto |
| `IntelligenceClient` | `intelligence-client.ts:25-45` | Swap mock for HTTP |
| `ParticipantMappingStore` | `participant-mapping-store.ts:5-25` | Swap in-memory for DB |
| `SessionStore` | `session-store.ts:10-30` | Swap in-memory for DB |
| `WorkflowStore` | `workflow-store.ts:25-55` | Swap in-memory for DB |

---

## 11. Quick Reference

### 11.1 Commands

| Command | Format | Handler |
|---------|--------|---------|
| Register | `/register {"accountId":"...","publicKey":"...","signature":"...","message":"..."}` | `workflow-handler.ts:205` |
| Resume | `/resume {"workflowId":"...","sessionId":"...","txHash":"..."}` | `workflow-handler.ts:280` |

### 11.2 Actions Returned

| Action | Meaning |
|--------|---------|
| `registration_required` | User not registered |
| `registered` | Registration successful |
| `already_registered` | User already registered |
| `registration_failed` | Registration failed |
| `session_found` | Valid session exists |
| `session_creation_required` | Need wallet signature |
| `session_resumed` | Session activated after resume |
| `session_pending` | Transaction still pending |
| `session_failed` | Transaction failed |
| `unknown_intent` | Could not classify request |
| `error` | Internal error |

### 11.3 Key File Locations

| Purpose | File |
|---------|------|
| Plugin entry | `src/index.ts` |
| Message routing | `src/handlers/workflow-handler.ts` |
| Registration | `src/services/registration-service.ts` |
| Session orchestration | `src/services/session-orchestrator.ts` |
| Resume handling | `src/services/resume-handler.ts` |
| Intelligence API | `src/services/intelligence-client.ts` |
| Types | `src/types/*.ts` |
| Tests | `tests/*.test.ts` |
