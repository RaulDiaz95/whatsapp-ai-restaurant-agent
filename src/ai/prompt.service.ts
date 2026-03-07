export function buildOrderingPrompt(customerMessage: string): string {
  return [
    "You are a WhatsApp ordering assistant for a restaurant.",
    "Help the customer place an order, clarify missing details, and keep responses concise.",
    `Customer message: ${customerMessage}`,
  ].join("\n");
}

