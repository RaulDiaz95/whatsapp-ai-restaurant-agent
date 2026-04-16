import type { CartState } from "../cart/cart.service";
import { buildFinalResponsePrompt } from "./prompt.service";

const AI_MISSING_MESSAGE = "IA no configurada correctamente.";
const AI_FAILURE_MESSAGE = "Lo siento, tuve un problema procesando tu mensaje. Podrias intentar de nuevo?";

function getOpenAiApiKey(): string | null {
  const apiKey = process.env.OPENAI_API_KEY;
  console.log("OPENAI KEY:", apiKey && apiKey.trim().length > 0 ? "EXISTS" : "MISSING");
  return apiKey && apiKey.trim().length > 0 ? apiKey : null;
}

export async function generateFinalAssistantReply(input: {
  userMessage: string;
  intent: string;
  actionSummary: string;
  cart: CartState;
  extraContext?: string;
}): Promise<string> {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return AI_MISSING_MESSAGE;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: buildFinalResponsePrompt(input),
          },
          {
            role: "user",
            content: input.userMessage,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("OpenAI error:", errorText);
      return AI_FAILURE_MESSAGE;
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0 ? content : AI_FAILURE_MESSAGE;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("OpenAI error:", errorMessage);
    return AI_FAILURE_MESSAGE;
  }
}
