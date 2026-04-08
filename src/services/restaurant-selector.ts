/**
 * RestaurantSelector
 *
 * Responsible for:
 *  1. Classifying user messages (generic vs specific, extracting hints)
 *  2. Fetching cuisine/meal options for the preference keyboard
 *  3. Selecting the best restaurant for a preference-based request
 *  4. Finding a restaurant for a specific dish/cuisine request (returns null if unavailable)
 *
 * Restaurant directory is fetched from Pinata once at startup and cached in memory.
 */

// ── Public interfaces ──────────────────────────────────────────────────────────

export interface DishOption {
  name: string;
  description?: string;
  calories?: number;
  protein?: string;
  carbs?: string;
  fat?: string;
  allergens?: string;
}

export interface SelectedRestaurant {
  name: string;
  cuisine: string;
  delivery_mins: number;
  menu_items: DishOption[];
}

/** Structured output from classifying a user's food order message. */
export interface RequestClassification {
  type: 'generic' | 'specific';
  /** Detected meal time context, if any. */
  mealTime?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  /** Cuisine type hint extracted from the message, e.g. "Indian". */
  cuisineHint?: string;
  /** Specific dish hint extracted from the message, e.g. "biryani". */
  dishHint?: string;
  /** Any constraint mentioned, e.g. "under 200 kcal", "within 30 mins". */
  constraint?: string;
}

export interface RestaurantSelectorConfig {
  /** Anthropic API key (primary LLM) */
  claudeApiKey: string;
  /** Claude model — defaults to claude-sonnet-4-6 */
  claudeModel?: string;
  /** Google AI Studio key (fallback LLM) */
  geminiApiKey: string;
  /** Gemini model — defaults to gemini-2.0-flash */
  geminiModel?: string;
  /** Pinata gateway URL to the restaurant directory file */
  restaurantDataUrl: string;
  /** Optional Pinata gateway key (for private gateways) */
  pinataGatewayKey?: string;
}

// ── LLM API types ─────────────────────────────────────────────────────────────

interface GeminiResponse {
  candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  error?: { message: string };
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
  error?: { message: string };
}

// ── System prompts ─────────────────────────────────────────────────────────────

const RESTAURANT_SELECTION_PROMPT = `You are a restaurant selection assistant.
Given a restaurant directory and a user's food order request, select the single best matching restaurant.

Selection rules:
- If the user mentions a specific cuisine (e.g. "Indian", "Chinese"), pick a restaurant of that cuisine.
- If the user mentions a delivery time constraint (e.g. "within 30 mins"), pick the restaurant with the shortest delivery time.
- If the user mentions a specific restaurant name, pick that one.
- If no specific preference is stated, pick the most generally suitable restaurant.

Output rules (STRICT):
- Return ONLY a single valid JSON object — no markdown, no code fences, no explanation.
- Use EXACTLY these field names:
  - "name" (string) — restaurant name
  - "cuisine" (string) — cuisine type
  - "delivery_mins" (number) — plain integer
  - "menu_items" (array) — each item: "name", "description", "calories" (number), "protein", "carbs", "fat", "allergens"

Example:
{"name":"Spice Garden","cuisine":"Indian","delivery_mins":25,"menu_items":[{"name":"Butter Chicken","description":"Creamy tomato sauce","calories":420,"protein":"32g","carbs":"18g","fat":"22g","allergens":"Dairy"}]}`;

// ── RestaurantSelector class ───────────────────────────────────────────────────

export class RestaurantSelector {
  private cachedData: string | null = null;

  constructor(private readonly config: RestaurantSelectorConfig) {}

  /**
   * Fetch and cache the restaurant directory from Pinata.
   * Must be called once at bot startup before any other method.
   */
  async initialize(): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.config.pinataGatewayKey) {
      headers['x-pinata-gateway-token'] = this.config.pinataGatewayKey;
    }

    const res = await fetch(this.config.restaurantDataUrl, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch restaurant data (${res.status}): ${await res.text()}`);
    }

    this.cachedData = await res.text();
    console.log(`[restaurant-selector] Loaded ${this.cachedData.length} bytes of restaurant data`);
  }

  /**
   * Classify a user's food order message.
   * Returns whether the request is generic or specific, along with extracted hints.
   * Falls back to 'generic' on any error so the user always gets a valid path.
   */
  async classifyRequest(message: string): Promise<RequestClassification> {
    const prompt =
      `Classify this food order message: "${message}"\n\n` +
      `GENERIC: no specific dish, cuisine, restaurant name, or constraint (price/calories/time/dietary).\n` +
      `SPECIFIC: mentions any of — a dish name, cuisine type, restaurant name, price/calorie/time constraint, or dietary requirement.\n\n` +
      `Return ONLY valid JSON (null for absent fields):\n` +
      `{"type":"generic or specific","mealTime":"breakfast or lunch or dinner or snack or null","cuisineHint":"e.g. Indian or null","dishHint":"e.g. biryani or null","constraint":"e.g. under 200 kcal or null"}`;

    try {
      const raw = await this.callLLM(prompt);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned) as RequestClassification;

      const classification: RequestClassification = {
        type: parsed.type === 'specific' ? 'specific' : 'generic',
      };
      if (parsed.mealTime) classification.mealTime = parsed.mealTime;
      if (parsed.cuisineHint) classification.cuisineHint = parsed.cuisineHint;
      if (parsed.dishHint) classification.dishHint = parsed.dishHint;
      if (parsed.constraint) classification.constraint = parsed.constraint;
      return classification;
    } catch (err) {
      console.warn('[restaurant-selector] classifyRequest failed, defaulting to generic:', err);
      return { type: 'generic' };
    }
  }

  /**
   * Extract available cuisine types and meal categories from the restaurant directory.
   * Used to populate the preference keyboard for generic requests.
   */
  async getAvailableOptions(): Promise<{ cuisines: string[]; mealTypes: string[] }> {
    this.assertInitialized();

    const prompt =
      `Restaurant directory:\n${this.cachedData}\n\n` +
      `Extract:\n` +
      `1. All unique cuisine types (e.g. "Indian", "Chinese")\n` +
      `2. Up to 5 common meal/food categories across all restaurants (e.g. "Biryani", "Pizza")\n\n` +
      `Return ONLY valid JSON:\n` +
      `{"cuisines":["..."],"mealTypes":["..."]}`;

    try {
      const raw = await this.callLLM(prompt);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned) as { cuisines: string[]; mealTypes: string[] };
      return {
        cuisines: Array.isArray(parsed.cuisines) ? parsed.cuisines : [],
        mealTypes: Array.isArray(parsed.mealTypes) ? parsed.mealTypes : [],
      };
    } catch (err) {
      console.warn('[restaurant-selector] getAvailableOptions failed:', err);
      return { cuisines: [], mealTypes: [] };
    }
  }

  /**
   * Select the best restaurant matching a preference-based request.
   * Used after the user picks a cuisine or meal type from the keyboard.
   * Always returns a restaurant (picks the most suitable one from the directory).
   */
  async selectRestaurant(preference: string): Promise<SelectedRestaurant> {
    this.assertInitialized();

    const userPrompt =
      `Restaurant directory:\n${this.cachedData}\n\n` +
      `User preference: "${preference}"\n\n` +
      `Select the single best matching restaurant and return its full menu as JSON.`;

    const raw = await this.callLLM(userPrompt, RESTAURANT_SELECTION_PROMPT);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const parsed = JSON.parse(cleaned) as SelectedRestaurant;
    if (!parsed.name || !Array.isArray(parsed.menu_items)) {
      throw new Error(`Invalid restaurant response: ${raw}`);
    }
    return parsed;
  }

  /**
   * Find the best restaurant that serves the user's specific request.
   * Returns null if no restaurant in the directory matches.
   * Used for specific item/cuisine requests before passing to access-bot.
   */
  async findRestaurantForRequest(
    message: string,
    classification: RequestClassification,
  ): Promise<SelectedRestaurant | null> {
    this.assertInitialized();

    const hint = classification.dishHint ?? classification.cuisineHint ?? message;
    const constraint = classification.constraint ? ` (constraint: ${classification.constraint})` : '';

    const prompt =
      `Restaurant directory:\n${this.cachedData}\n\n` +
      `User wants: "${hint}"${constraint}\n\n` +
      `Search the directory. Does any restaurant serve this dish type or cuisine?\n\n` +
      `If YES, return the best matching restaurant with its COMPLETE menu:\n` +
      `{"found":true,"name":"...","cuisine":"...","delivery_mins":25,"menu_items":[{"name":"...","description":"...","calories":0,"protein":"...","carbs":"...","fat":"...","allergens":"..."}]}\n\n` +
      `If NO restaurant serves anything matching this request, return:\n` +
      `{"found":false}\n\n` +
      `Return ONLY valid JSON. No markdown. No explanation.`;

    try {
      const raw = await this.callLLM(prompt);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned) as { found: boolean } & SelectedRestaurant;

      if (!parsed.found) return null;
      if (!parsed.name || !Array.isArray(parsed.menu_items)) return null;

      return {
        name: parsed.name,
        cuisine: parsed.cuisine,
        delivery_mins: parsed.delivery_mins,
        menu_items: parsed.menu_items,
      };
    } catch (err) {
      console.warn('[restaurant-selector] findRestaurantForRequest failed:', err);
      return null;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private assertInitialized(): void {
    if (!this.cachedData) {
      throw new Error('RestaurantSelector not initialized — call initialize() first');
    }
  }

  /** Routes to Claude→Gemini fallback when claudeApiKey is set, otherwise Gemini only. */
  private async callLLM(userPrompt: string, systemPrompt?: string): Promise<string> {
    if (!this.config.claudeApiKey) {
      return this.callGemini(userPrompt, systemPrompt);
    }
    try {
      const result = await this.callClaude(userPrompt, systemPrompt);
      console.log('[restaurant-selector] LLM: Claude responded OK');
      return result;
    } catch (err) {
      console.warn('[restaurant-selector] Claude failed, falling back to Gemini:', (err as Error).message);
      return this.callGemini(userPrompt, systemPrompt);
    }
  }

  private async callClaude(userPrompt: string, systemPrompt?: string): Promise<string> {
    const model = this.config.claudeModel ?? 'claude-sonnet-4-6';
    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: userPrompt }],
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Claude API error (${res.status}): ${await res.text()}`);
    }

    const data = await res.json() as ClaudeResponse;
    if (data.error) throw new Error(`Claude error: ${data.error.message}`);
    const text = data.content.find(c => c.type === 'text')?.text;
    if (!text) throw new Error('Claude returned no text content');
    return text;
  }

  private async callGemini(userPrompt: string, systemPrompt?: string): Promise<string> {
    const model = this.config.geminiModel ?? 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.geminiApiKey}`;

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gemini API error (${res.status}): ${await res.text()}`);
    }

    const data = await res.json() as GeminiResponse;
    if (data.error) throw new Error(`Gemini error: ${data.error.message}`);
    if (!data.candidates?.length) throw new Error('Gemini returned no candidates');

    return (data.candidates[0]?.content.parts ?? []).map(p => p.text).join('');
  }
}

export function createRestaurantSelector(config: RestaurantSelectorConfig): RestaurantSelector {
  return new RestaurantSelector(config);
}
