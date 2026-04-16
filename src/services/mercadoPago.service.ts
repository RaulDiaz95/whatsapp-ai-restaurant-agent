export async function createPaymentLink(total: number): Promise<string> {
  const token = process.env.MP_ACCESS_TOKEN;

  if (!token || token.trim().length === 0) {
    console.error("MercadoPago error: MP_ACCESS_TOKEN is missing");
    throw new Error("Error creating payment link");
  }

  console.log("Generating MercadoPago link for:", total);

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          title: "Pedido Sushi 🍣",
          quantity: 1,
          currency_id: "MXN",
          unit_price: total,
        },
      ],
    }),
  });

  if (!res.ok) {
    const error = await res.text().catch(() => "");
    console.error("MercadoPago error:", error);
    throw new Error("Error creating payment link");
  }

  const data = (await res.json()) as { init_point?: string };

  if (!data.init_point) {
    console.error("MercadoPago error: init_point missing in response");
    throw new Error("Error creating payment link");
  }

  return data.init_point;
}
