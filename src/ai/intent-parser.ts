import { buildOrderingPrompt } from "./prompt.service";
import { findMenuItemByName, findMatchingExtra, findMatchingModifier, normalizeText, sushiMenu } from "../menu/sushi-menu";

export type ParsedIntentItem = {
  name: string;
  quantity: number;
  extras: string[];
  modifiers: string[];
};

export type ParsedIntent = {
  action: "add_to_cart" | "remove_item" | "view_cart" | "show_menu" | "recommend" | "none";
  items: ParsedIntentItem[];
  index: number | null;
};

export type ParseIntentStatus = "used_openai" | "missing_api_key" | "openai_error" | "explicit_command" | "deterministic_fallback";

export type ParseIntentResult = {
  intent: ParsedIntent;
  status: ParseIntentStatus;
};

const EMPTY_INTENT: ParsedIntent = {
  action: "none",
  items: [],
  index: null,
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
  const allowedActions = new Set(["add_to_cart", "remove_item", "view_cart", "show_menu", "recommend", "none"]);
  const action = typeof raw.action === "string" && allowedActions.has(raw.action) ? (raw.action as ParsedIntent["action"]) : "none";
  const index = typeof raw.index === "number" && Number.isFinite(raw.index) ? raw.index : null;
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const rawItem = item as Record<string, unknown>;
          const candidateName = typeof rawItem.name === "string" ? rawItem.name : "";
          const matchedMenuItem = findMenuItemByName(candidateName);
          const extras = Array.isArray(rawItem.extras) ? rawItem.extras.filter((extra): extra is string => typeof extra === "string") : [];
          const modifiers = Array.isArray(rawItem.modifiers)
            ? rawItem.modifiers.filter((modifier): modifier is string => typeof modifier === "string")
            : [];
          const normalizedExtras = matchedMenuItem
            ? extras
                .map((extra) => findMatchingExtra(matchedMenuItem, extra)?.name ?? null)
                .filter((extra): extra is string => extra !== null)
            : [];
          const normalizedModifiers = matchedMenuItem
            ? modifiers
                .map((modifier) => findMatchingModifier(matchedMenuItem, modifier)?.name ?? null)
                .filter((modifier): modifier is string => modifier !== null)
            : [];

          return {
            name: matchedMenuItem?.name ?? "",
            quantity:
              typeof rawItem.quantity === "number" && Number.isFinite(rawItem.quantity) ? Math.max(1, Math.trunc(rawItem.quantity)) : 1,
            extras: normalizedExtras,
            modifiers: normalizedModifiers,
          } satisfies ParsedIntentItem;
        })
        .filter((item): item is ParsedIntentItem => Boolean(item?.name))
    : [];

  return { action, items, index };
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
          content: buildOrderingPrompt(customerMessage),
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

function splitItemSegments(message: string): string[] {
  return message
    .split(/\s+y\s+|,/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
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
        modifiers: extractModifiersForItem(segment, menuItem.name),
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
      modifiers: extractModifiersForItem(message, fallbackMenuItem.name),
    },
  ];
}

function parseIntentDeterministically(customerMessage: string): ParsedIntent {
  const normalizedMessage = normalizeText(customerMessage);

  if (!normalizedMessage) {
    return EMPTY_INTENT;
  }

  if (/\b(menu|carta)\b/.test(normalizedMessage)) {
    return { action: "show_menu", items: [], index: null };
  }

  if (/\b(ver carrito|carrito|mi pedido|mi orden)\b/.test(normalizedMessage)) {
    return { action: "view_cart", items: [], index: null };
  }

  if (/\b(recomienda|recomendacion|sugerencia|sugiere)\b/.test(normalizedMessage)) {
    return { action: "recommend", items: [], index: null };
  }

  if (/\b(quita|elimina|remueve|remove)\b/.test(normalizedMessage)) {
    const indexMatch = normalizedMessage.match(/\b(?:quita|elimina|remueve|remove)\s+(?:el\s+)?(\d+)\b/);
    const indexValue = indexMatch?.[1];
    return {
      action: "remove_item",
      items: extractItemsFromMessage(customerMessage),
      index: indexValue ? Number.parseInt(indexValue, 10) : null,
    };
  }

  if (/\b(agrega|agregar|quiero|dame|pon|anade|ordena|pide)\b/.test(normalizedMessage)) {
    return {
      action: "add_to_cart",
      items: extractItemsFromMessage(customerMessage),
      index: null,
    };
  }

  if (extractItemsFromMessage(customerMessage).length > 0) {
    return {
      action: "add_to_cart",
      items: extractItemsFromMessage(customerMessage),
      index: null,
    };
  }

  return EMPTY_INTENT;
}

function parseExplicitCommand(customerMessage: string): ParsedIntent | null {
  const normalizedMessage = normalizeText(customerMessage);

  if (/\b(menu|carta)\b/.test(normalizedMessage)) {
    return { action: "show_menu", items: [], index: null };
  }

  if (/\b(ver carrito|carrito|mi pedido|mi orden)\b/.test(normalizedMessage)) {
    return { action: "view_cart", items: [], index: null };
  }

  return null;
}

export async function parseIntent(customerMessage: string): Promise<ParseIntentResult> {
  const explicitCommand = parseExplicitCommand(customerMessage);

  if (explicitCommand) {
    return {
      intent: explicitCommand,
      status: "explicit_command",
    };
  }

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
