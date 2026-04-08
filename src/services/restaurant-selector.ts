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

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract the first JSON object or array from an LLM response.
 * Handles preamble text ("Looking through..."), markdown fences, and trailing text.
 */
function extractJson(raw: string): string {
  // Strip markdown code fences first
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If it already starts with { or [, use it directly
  if (stripped.startsWith('{') || stripped.startsWith('[')) return stripped;
  // Otherwise find the first { or [ and extract to its matching closer
  const start = stripped.search(/[{[]/);
  if (start === -1) throw new SyntaxError(`No JSON object found in LLM response: ${raw.slice(0, 100)}`);
  return stripped.slice(start);
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
- If the user mentions a nutrition constraint (e.g. "less than 30g carbs", "under 200 kcal", "more than 40g protein", "low fat"), pick the restaurant that has the most dishes satisfying that constraint.
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
  // Parsed version of cachedData for O(1) name lookup — avoids a second LLM call.
  private cachedRestaurants: SelectedRestaurant[] | null = null;

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

    this.cachedRestaurants = RestaurantSelector.parseMarkdownDirectory(this.cachedData);
    console.log(`[restaurant-selector] Parsed ${this.cachedRestaurants.length} restaurants for fast lookup`);
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
      `{"type":"generic or specific","mealTime":"breakfast or lunch or dinner or snack or null","cuisineHint":"e.g. Indian or null","dishHint":"e.g. biryani or null","constraint":"e.g. under 200 kcal, less than 30g carbs, more than 40g protein, within 30g fat, within 30 mins or null"}`;

    try {
      const raw = await this.callLLM(prompt);
      const parsed = JSON.parse(extractJson(raw)) as RequestClassification;

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
      const parsed = JSON.parse(extractJson(raw)) as { cuisines: string[]; mealTypes: string[] };
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
    const parsed = JSON.parse(extractJson(raw)) as SelectedRestaurant;
    if (!parsed.name || !Array.isArray(parsed.menu_items)) {
      throw new Error(`Invalid restaurant response: ${raw.slice(0, 200)}`);
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

    // If the user's message contains a nutrition intent, extract a structured constraint
    // via LLM (small input/output, no restaurant data) then filter the cache in code.
    if (this.cachedRestaurants) {
      const nutrition = await this.extractNutritionConstraint(message);
      if (nutrition) {
        console.log(`[restaurant-selector] Nutrition filter: ${nutrition.field} ${nutrition.op} ${nutrition.value}`);
        return RestaurantSelector.pickByNutrition(this.cachedRestaurants, nutrition);
      }
    }

    // For everything else (cuisine, dish name, delivery time) — ask the LLM to pick
    // the restaurant name, then look it up from the parsed cache.
    const hint = classification.dishHint ?? classification.cuisineHint ?? message;
    const constraint = classification.constraint ? ` (constraint: ${classification.constraint})` : '';

    const pickSystemPrompt =
      `You are a restaurant picker. You MUST respond with ONLY a valid JSON object — no text, no explanation, no reasoning. ` +
      `First character must be '{', last must be '}'. ` +
      `If a restaurant matches: {"found":true,"name":"exact name from directory","cuisine":"...","delivery_mins":25} ` +
      `If nothing matches: {"found":false}`;

    const pickPrompt =
      `Restaurant directory:\n${this.cachedData}\n\n` +
      `User wants: "${hint}"${constraint}\n\n` +
      `Which single restaurant best matches? Return ONLY the JSON object.`;

    const pickRaw = await this.callLLM(pickPrompt, pickSystemPrompt, 512);
    const pickCleaned = pickRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let picked: { found: boolean; name?: string; cuisine?: string; delivery_mins?: number };
    try {
      picked = JSON.parse(pickCleaned);
    } catch (parseErr) {
      throw new Error(`Failed to parse restaurant pick response: ${(parseErr as Error).message}`);
    }

    if (!picked.found || !picked.name) return null;

    if (this.cachedRestaurants) {
      const nameLower = picked.name.toLowerCase();
      const entry = this.cachedRestaurants.find(r => r.name.toLowerCase() === nameLower)
        ?? this.cachedRestaurants.find(r => r.name.toLowerCase().includes(nameLower) || nameLower.includes(r.name.toLowerCase()));
      if (entry) return entry;
    }

    console.warn(`[restaurant-selector] Could not find "${picked.name}" in parsed cache`);
    return null;
  }

  /**
   * Ask the LLM to extract a structured nutrition constraint from the user's message.
   * Input is only the user message — no restaurant data. Small, fast, reliable JSON.
   * Returns null if the message has no nutrition intent.
   */
  private async extractNutritionConstraint(
    message: string,
  ): Promise<{ field: 'carbs' | 'fat' | 'protein' | 'calories'; op: '<' | '>'; value: number } | null> {
    const systemPrompt =
      `Extract a nutrition filter from the user's food order message. ` +
      `Return ONLY valid JSON — no explanation, no text. ` +
      `If a nutrition constraint exists: {"field":"carbs|fat|protein|calories","op":"<|>","value":NUMBER} ` +
      `If no nutrition constraint: {"field":null} ` +
      `field must be one of: carbs, fat, protein, calories. ` +
      `op must be "<" (less than / under / low / keto / light) or ">" (more than / high / rich). ` +
      `value must be a number. If the user says "low fat" or "keto" without a number, infer a reasonable threshold (e.g. fat<10, carbs<20).`;

    const prompt = `User message: "${message}"`;

    try {
      const raw = await this.callLLM(prompt, systemPrompt, 64);
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned) as { field: string | null; op?: string; value?: number };
      if (!parsed.field || !parsed.op || parsed.value === undefined) return null;
      if (!['carbs', 'fat', 'protein', 'calories'].includes(parsed.field)) return null;
      if (!['<', '>'].includes(parsed.op)) return null;
      return {
        field: parsed.field as 'carbs' | 'fat' | 'protein' | 'calories',
        op: parsed.op as '<' | '>',
        value: parsed.value,
      };
    } catch {
      return null;
    }
  }

  /** Pick the restaurant with the most dishes satisfying the nutrition constraint. */
  private static pickByNutrition(
    restaurants: SelectedRestaurant[],
    constraint: { field: 'carbs' | 'fat' | 'protein' | 'calories'; op: '<' | '>'; value: number },
  ): SelectedRestaurant | null {
    const countMatching = (r: SelectedRestaurant): number =>
      r.menu_items.filter(d => {
        const raw = constraint.field === 'calories' ? String(d.calories ?? '') : (d[constraint.field] ?? '');
        const num = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
        if (isNaN(num)) return false;
        return constraint.op === '<' ? num < constraint.value : num > constraint.value;
      }).length;

    let best: SelectedRestaurant | null = null;
    let bestCount = 0;
    for (const r of restaurants) {
      const count = countMatching(r);
      if (count > bestCount) { best = r; bestCount = count; }
    }
    return best;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Parse the Markdown restaurant directory into structured objects.
   * Format: ## Name, - **Cuisine:** ..., - **Delivery Time:** ..., then a menu table.
   */
  private static parseMarkdownDirectory(md: string): SelectedRestaurant[] {
    const restaurants: SelectedRestaurant[] = [];
    // Split on H2 headings — each section is one restaurant.
    const sections = md.split(/^## /m).slice(1); // slice(1) drops preamble before first ##

    for (const section of sections) {
      const lines = section.split('\n');
      const name = lines[0]?.trim() ?? '';

      let cuisine = '';
      let delivery_mins = 30;

      for (const line of lines) {
        const cuisineMatch = line.match(/\*\*Cuisine:\*\*\s*(.+)/);
        if (cuisineMatch?.[1]) cuisine = cuisineMatch[1].trim();

        const deliveryMatch = line.match(/\*\*Delivery Time:\*\*\s*(\d+)/);
        if (deliveryMatch?.[1]) delivery_mins = parseInt(deliveryMatch[1], 10);
      }

      // Parse the markdown table — skip header row and separator row.
      const menu_items: DishOption[] = [];
      let inTable = false;
      let headerSkipped = false;

      for (const line of lines) {
        if (!line.startsWith('|')) { inTable = false; headerSkipped = false; continue; }
        if (!inTable) { inTable = true; continue; } // header row — skip
        if (!headerSkipped) { headerSkipped = true; continue; } // separator row (---|---) — skip

        const cols = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
        if (cols.length < 7) continue;

        const [itemName, , description, calStr, protein, carbs, fat, allergens] = cols;
        if (!itemName || !description) continue;
        const caloriesMatch = calStr?.match(/\d+/);

        const entry: DishOption = {
          name: itemName,
          description,
          protein: protein ?? '',
          carbs: carbs ?? '',
          fat: fat ?? '',
          allergens: allergens ?? '',
        };
        if (caloriesMatch) entry.calories = parseInt(caloriesMatch[0], 10);
        menu_items.push(entry);
      }

      if (name && menu_items.length > 0) {
        restaurants.push({ name, cuisine, delivery_mins, menu_items });
      }
    }

    return restaurants;
  }

  private assertInitialized(): void {
    if (!this.cachedData) {
      throw new Error('RestaurantSelector not initialized — call initialize() first');
    }
  }

  /** Routes to Claude→Gemini fallback when claudeApiKey is set, otherwise Gemini only. */
  private async callLLM(userPrompt: string, systemPrompt?: string, maxTokens = 4096): Promise<string> {
    if (!this.config.claudeApiKey) {
      return this.callGemini(userPrompt, systemPrompt, maxTokens);
    }
    try {
      const result = await this.callClaude(userPrompt, systemPrompt, maxTokens);
      console.log('[restaurant-selector] LLM: Claude responded OK');
      return result;
    } catch (err) {
      console.warn('[restaurant-selector] Claude failed, falling back to Gemini:', (err as Error).message);
      return this.callGemini(userPrompt, systemPrompt, maxTokens);
    }
  }

  private async callClaude(userPrompt: string, systemPrompt?: string, maxTokens = 4096): Promise<string> {
    const model = this.config.claudeModel ?? 'claude-sonnet-4-6';
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
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

  private async callGemini(userPrompt: string, systemPrompt?: string, maxTokens = 4096): Promise<string> {
    const model = this.config.geminiModel ?? 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.geminiApiKey}`;

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
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
