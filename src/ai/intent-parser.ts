import { buildIntentPrompt } from "./prompt.service";
import { findMenuItemByName, findMatchingExtra, findMatchingModifier, normalizeText, sushiMenu } from "../menu/sushi-menu";

export type ParsedIntentItem = {
  name: string;
  quantity: number;
  extras: string[];
  removals: string[];
};

export type ParsedIntent = {
  intent: "add_to_cart" | "remove_item" | "clear_cart" | "view_cart" | "show_menu" | "unknown" | "recommend" | "checkout";
  items: ParsedIntentItem[];
  message: string;
};

export type ParseIntentStatus = "used_openai" | "missing_api_key" | "openai_error" | "deterministic_fallback";

export type ParseIntentResult = {
  intent: ParsedIntent;
  status: ParseIntentStatus;
};

const EMPTY_INTENT: ParsedIntent = {
  intent: "unknown",
  items: [],
  message: "",
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
  const allowedIntents = new Set(["add_to_cart", "remove_item", "clear_cart", "view_cart", "show_menu", "unknown", "recommend", "checkout"]);
  const intent = typeof raw.intent === "string" && allowedIntents.has(raw.intent) ? (raw.intent as ParsedIntent["intent"]) : "unknown";
  const message = typeof raw.message === "string" ? raw.message : "";
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const rawItem = item as Record<string, unknown>;
          const requestedName = typeof rawItem.name === "string" ? rawItem.name : "";
          const matchedMenuItem = requestedName ? findMenuItemByName(requestedName) : null;
          const extras = Array.isArray(rawItem.extras) ? rawItem.extras.filter((extra): extra is string => typeof extra === "string") : [];
          const removals = Array.isArray(rawItem.removals) ? rawItem.removals.filter((removal): removal is string => typeof removal === "string") : [];

          if (!matchedMenuItem) {
            return null;
          }

          return {
            name: matchedMenuItem.name,
            quantity:
              typeof rawItem.quantity === "number" && Number.isFinite(rawItem.quantity) ? Math.max(1, Math.trunc(rawItem.quantity)) : 1,
            extras: extras
              .map((extra) => findMatchingExtra(matchedMenuItem, extra)?.name ?? null)
              .filter((extra): extra is string => extra !== null),
            removals: removals
              .map((removal) => findMatchingModifier(matchedMenuItem, removal)?.name ?? null)
              .filter((removal): removal is string => removal !== null),
          } satisfies ParsedIntentItem;
        })
        .filter((item): item is ParsedIntentItem => item !== null)
    : [];

  return {
    intent,
    items,
    message,
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

function splitItemSegments(message: string): string[] {
  return message
    .split(/\s+y\s+|,/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
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

function extractItemsFromMessage(message: string): ParsedIntentItem[] {
  const normalizedMessage = normalizeText(message);
  const segments = splitItemSegments(message);
  const items: ParsedIntentItem[] = [];

  for (const segment of segments) {
    for (const menuItem of sushiMenu) {
      const candidates = [menuItem.name, ...(menuItem.aliases ?? [])];
      const matchedCandidate = candidates.find((candidate) => normalizedMessage.includes(normalizeText(candidate)) && normalizeText(segment).includes(normalizeText(candidate)));
      if (!matchedCandidate) {
        continue;
      }

      items.push({
        name: menuItem.name,
        quantity: extractQuantity(segment),
        extras: extractExtrasForItem(segment, menuItem.name),
        removals: extractModifiersForItem(segment, menuItem.name),
      });
      break;
    }
  }

  if (items.length > 0) {
    return items;
  }

  const fallbackMenuItem = findMenuItemByName(message);
  if (!fallbackMenuItem) {
    return [];
  }

  return [
    {
      name: fallbackMenuItem.name,
      quantity: extractQuantity(message),
      extras: extractExtrasForItem(message, fallbackMenuItem.name),
      removals: extractModifiersForItem(message, fallbackMenuItem.name),
    },
  ];
}

function parseIntentDeterministically(customerMessage: string): ParsedIntent {
  const normalizedMessage = normalizeText(customerMessage);
  const items = extractItemsFromMessage(customerMessage);

  if (!normalizedMessage) {
    return EMPTY_INTENT;
  }

  if (/\b(elimina todo|limpiar carrito|borra todo|vaciar carrito)\b/.test(normalizedMessage)) {
    return { intent: "clear_cart", items: [], message: "Listo, limpio el carrito." };
  }

  if (/\b(menu|carta)\b/.test(normalizedMessage)) {
    return { intent: "show_menu", items: [], message: "Claro, te muestro el menu." };
  }

  if (/\b(ver carrito|carrito|mi pedido|mi orden)\b/.test(normalizedMessage)) {
    return { intent: "view_cart", items: [], message: "Claro, reviso tu carrito." };
  }

  if (/\b(recomienda|recomendacion|sugerencia|sugiere)\b/.test(normalizedMessage)) {
    return { intent: "recommend", items: [], message: "Te ayudo con una recomendacion." };
  }

  if (/\b(finalizar|checkout|pagar|terminar pedido)\b/.test(normalizedMessage)) {
    return { intent: "checkout", items: [], message: "Vamos a finalizar tu pedido." };
  }

  if (/\b(quita|elimina|remueve|remove)\b/.test(normalizedMessage)) {
    return {
      intent: "remove_item",
      items,
      message: "Entendido, retiro eso de tu carrito.",
    };
  }

  if (/\b(agrega|agregar|quiero|dame|pon|anade|ordena|pide)\b/.test(normalizedMessage)) {
    return {
      intent: "add_to_cart",
      items,
      message: "Perfecto, lo agrego a tu pedido.",
    };
  }

  if (items.length > 0) {
    return {
      intent: "add_to_cart",
      items,
      message: "Perfecto, lo agrego a tu pedido.",
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
