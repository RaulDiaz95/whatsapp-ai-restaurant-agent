import { buildIntentPrompt } from "./prompt.service";
import { findMenuItemByName, findMatchingExtra, findMatchingModifier, normalizeText, sushiMenu } from "../menu/sushi-menu";

export type ParsedIntent = {
  intent: "add_to_cart" | "remove_item" | "show_menu" | "show_cart" | "recommend" | "checkout" | "smalltalk";
  product: string | null;
  quantity: number | null;
  extras: string[];
  removeIngredients: string[];
};

export type ParseIntentStatus = "used_openai" | "missing_api_key" | "openai_error" | "deterministic_fallback";

export type ParseIntentResult = {
  intent: ParsedIntent;
  status: ParseIntentStatus;
};

const EMPTY_INTENT: ParsedIntent = {
  intent: "smalltalk",
  product: null,
  quantity: null,
  extras: [],
  removeIngredients: [],
};

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeIntent(input: unknown): ParsedIntent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return EMPTY_INTENT;
  }

  const raw = input as Record<string, unknown>;
  const allowedIntents = new Set(["add_to_cart", "remove_item", "show_menu", "show_cart", "recommend", "checkout", "smalltalk"]);
  const intent =
    typeof raw.intent === "string" && allowedIntents.has(raw.intent) ? (raw.intent as ParsedIntent["intent"]) : "smalltalk";
  const requestedProduct = typeof raw.product === "string" ? raw.product : "";
  const matchedMenuItem = requestedProduct ? findMenuItemByName(requestedProduct) : null;
  const extras = Array.isArray(raw.extras) ? raw.extras.filter((extra): extra is string => typeof extra === "string") : [];
  const removeIngredients = Array.isArray(raw.removeIngredients)
    ? raw.removeIngredients.filter((modifier): modifier is string => typeof modifier === "string")
    : [];

  return {
    intent,
    product: matchedMenuItem?.name ?? null,
    quantity: typeof raw.quantity === "number" && Number.isFinite(raw.quantity) ? Math.max(1, Math.trunc(raw.quantity)) : null,
    extras: matchedMenuItem
      ? extras
          .map((extra) => findMatchingExtra(matchedMenuItem, extra)?.name ?? null)
          .filter((extra): extra is string => extra !== null)
      : [],
    removeIngredients: matchedMenuItem
      ? removeIngredients
          .map((modifier) => findMatchingModifier(matchedMenuItem, modifier)?.name ?? null)
          .filter((modifier): modifier is string => modifier !== null)
      : removeIngredients,
  };
}

function getOpenAiApiKey(): string | null {
  const apiKey = process.env.OPENAI_API_KEY;
  console.log("OPENAI KEY:", apiKey && apiKey.trim().length > 0 ? "EXISTS" : "MISSING");
  return apiKey && apiKey.trim().length > 0 ? apiKey : null;
}

async function parseIntentWithOpenAI(customerMessage: string): Promise<ParsedIntent | null> {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: buildIntentPrompt(),
        },
        {
          role: "user",
          content: customerMessage,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("OpenAI error:", errorText);
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content ?? "";
  return normalizeIntent(safeJsonParse(content));
}

function extractQuantity(segment: string): number {
  const quantityMatch = normalizeText(segment).match(/\b(\d+)\b/);
  const quantityValue = quantityMatch?.[1];
  if (quantityValue) {
    return Math.max(1, Number.parseInt(quantityValue, 10));
  }

  if (/\b(un|una)\b/.test(normalizeText(segment))) {
    return 1;
  }

  return 1;
}

function extractExtrasForItem(segment: string, itemName: string): string[] {
  const menuItem = findMenuItemByName(itemName);
  if (!menuItem) {
    return [];
  }

  const normalizedSegment = normalizeText(segment);
  const extras = new Set<string>();

  for (const extra of menuItem.extras) {
    const candidates = [extra.name, ...(extra.aliases ?? [])];
    if (
      candidates.some((candidate) => {
        const normalizedCandidate = normalizeText(candidate);
        return normalizedSegment.includes(normalizedCandidate);
      })
    ) {
      const matchedExtra = findMatchingExtra(menuItem, extra.name);
      if (matchedExtra) {
        extras.add(matchedExtra.name);
      }
    }
  }

  return [...extras];
}

function extractModifiersForItem(segment: string, itemName: string): string[] {
  const menuItem = findMenuItemByName(itemName);
  if (!menuItem) {
    return [];
  }

  const normalizedSegment = normalizeText(segment);
  const modifiers = new Set<string>();

  for (const modifier of menuItem.modifiers) {
    const candidates = [modifier.name, ...(modifier.aliases ?? [])];
    if (candidates.some((candidate) => normalizedSegment.includes(normalizeText(candidate)))) {
      const matchedModifier = findMatchingModifier(menuItem, modifier.name);
      if (matchedModifier) {
        modifiers.add(matchedModifier.name);
      }
    }
  }

  return [...modifiers];
}

function extractProductFromMessage(message: string): string | null {
  const normalizedMessage = normalizeText(message);

  for (const menuItem of sushiMenu) {
    const candidates = [menuItem.name, ...(menuItem.aliases ?? [])];
    if (candidates.some((candidate) => normalizedMessage.includes(normalizeText(candidate)))) {
      return menuItem.name;
    }
  }

  const fallbackMenuItem = findMenuItemByName(message);
  return fallbackMenuItem?.name ?? null;
}

function parseIntentDeterministically(customerMessage: string): ParsedIntent {
  const normalizedMessage = normalizeText(customerMessage);
  const product = extractProductFromMessage(customerMessage);

  if (!normalizedMessage) {
    return EMPTY_INTENT;
  }

  if (/\b(menu|carta)\b/.test(normalizedMessage)) {
    return { intent: "show_menu", product: null, quantity: null, extras: [], removeIngredients: [] };
  }

  if (/\b(ver carrito|carrito|mi pedido|mi orden)\b/.test(normalizedMessage)) {
    return { intent: "show_cart", product: null, quantity: null, extras: [], removeIngredients: [] };
  }

  if (/\b(recomienda|recomendacion|sugerencia|sugiere)\b/.test(normalizedMessage)) {
    return { intent: "recommend", product: null, quantity: null, extras: [], removeIngredients: [] };
  }

  if (/\b(finalizar|checkout|pagar|terminar pedido)\b/.test(normalizedMessage)) {
    return { intent: "checkout", product: null, quantity: null, extras: [], removeIngredients: [] };
  }

  if (/\b(quita|elimina|remueve|remove)\b/.test(normalizedMessage)) {
    return {
      intent: "remove_item",
      product,
      quantity: extractQuantity(customerMessage),
      extras: [],
      removeIngredients: [],
    };
  }

  if (/\b(agrega|agregar|quiero|dame|pon|anade|ordena|pide)\b/.test(normalizedMessage)) {
    return {
      intent: "add_to_cart",
      product,
      quantity: product ? extractQuantity(customerMessage) : null,
      extras: product ? extractExtrasForItem(customerMessage, product) : [],
      removeIngredients: product ? extractModifiersForItem(customerMessage, product) : [],
    };
  }

  if (product) {
    return {
      intent: "add_to_cart",
      product,
      quantity: extractQuantity(customerMessage),
      extras: extractExtrasForItem(customerMessage, product),
      removeIngredients: extractModifiersForItem(customerMessage, product),
    };
  }

  return EMPTY_INTENT;
}

export async function parseIntent(customerMessage: string): Promise<ParseIntentResult> {
  if (!getOpenAiApiKey()) {
    return {
      intent: parseIntentDeterministically(customerMessage),
      status: "missing_api_key",
    };
  }

  try {
    const aiIntent = await parseIntentWithOpenAI(customerMessage);
    if (aiIntent) {
      return {
        intent: aiIntent,
        status: "used_openai",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("OpenAI error:", errorMessage);
    return {
      intent: parseIntentDeterministically(customerMessage),
      status: "openai_error",
    };
  }

  return {
    intent: parseIntentDeterministically(customerMessage),
    status: "deterministic_fallback",
  };
}
