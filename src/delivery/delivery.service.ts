export type DeliveryQuote = {
  fee: number;
  etaMinutes: number;
  currency: string;
};

export class DeliveryService {
  getQuote(address: string): DeliveryQuote {
    void address;

    return {
      fee: 40 + Math.floor(Math.random() * 30),
      etaMinutes: 30 + Math.floor(Math.random() * 20),
      currency: "MXN",
    };
  }
}
