export type MenuExtra = {
  name: string;
  price: number;
  aliases?: string[];
};

export type MenuModifier = {
  name: string;
  aliases?: string[];
};

export type MenuItem = {
  name: string;
  price: number;
  description?: string;
  aliases?: string[];
  extras: MenuExtra[];
  modifiers: MenuModifier[];
};

const defaultExtras: MenuExtra[] = [
  { name: "aguacate", price: 20, aliases: ["extra aguacate", "con aguacate"] },
  { name: "queso crema", price: 15, aliases: ["extra queso crema", "con queso crema"] },
  { name: "tampico", price: 18, aliases: ["extra tampico", "con tampico"] },
  { name: "salsa picante", price: 10, aliases: ["extra salsa picante", "con salsa picante"] },
];

const defaultModifiers: MenuModifier[] = [
  { name: "sin arroz" },
  { name: "sin picante" },
  { name: "sin alga" },
];

export const sushiMenu: MenuItem[] = [
  {
    name: "California Roll",
    price: 150,
    description: "Cangrejo, pepino y aguacate.",
    aliases: ["california"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
  {
    name: "Spicy Tuna Roll",
    price: 165,
    description: "Atun picante con pepino y ajonjoli.",
    aliases: ["spicy tuna", "tuna picante"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
  {
    name: "Philadelphia Roll",
    price: 160,
    description: "Salmon, queso crema y pepino.",
    aliases: ["philadelphia"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
  {
    name: "Dragon Roll",
    price: 190,
    description: "Camaron tempura, pepino y aguacate por fuera.",
    aliases: ["dragon"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
  {
    name: "Tempura Roll",
    price: 175,
    description: "Rollo empanizado con camaron y queso crema.",
    aliases: ["tempura"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
  {
    name: "Salmon Nigiri",
    price: 140,
    description: "Bocado de arroz con salmon fresco.",
    aliases: ["nigiri de salmon", "salmon"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
  {
    name: "Tuna Nigiri",
    price: 145,
    description: "Bocado de arroz con atun fresco.",
    aliases: ["nigiri de atun", "atun"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
  {
    name: "Ebi Roll",
    price: 170,
    description: "Camaron, aguacate y pepino.",
    aliases: ["ebi"],
    extras: defaultExtras,
    modifiers: defaultModifiers,
  },
];

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCandidateNames(item: MenuItem): string[] {
  return [item.name, ...(item.aliases ?? [])];
}

export function findMenuItemByName(name: string): MenuItem | null {
  const query = normalizeText(name);

  if (!query) {
    return null;
  }

  for (const item of sushiMenu) {
    for (const candidate of getCandidateNames(item)) {
      if (normalizeText(candidate) === query) {
        return item;
      }
    }
  }

  let bestMatch: MenuItem | null = null;
  let bestScore = 0;

  for (const item of sushiMenu) {
    for (const candidate of getCandidateNames(item)) {
      const normalizedCandidate = normalizeText(candidate);
      if (normalizedCandidate.includes(query) || query.includes(normalizedCandidate)) {
        const score = Math.min(normalizedCandidate.length, query.length);
        if (score > bestScore) {
          bestMatch = item;
          bestScore = score;
        }
      }
    }
  }

  return bestMatch;
}

export function findMatchingExtra(item: MenuItem, rawExtra: string): MenuExtra | null {
  const query = normalizeText(rawExtra);

  for (const extra of item.extras) {
    const candidates = [extra.name, ...(extra.aliases ?? [])];
    if (candidates.some((candidate) => normalizeText(candidate) === query)) {
      return extra;
    }
  }

  for (const extra of item.extras) {
    const candidates = [extra.name, ...(extra.aliases ?? [])];
    if (candidates.some((candidate) => normalizeText(candidate).includes(query) || query.includes(normalizeText(candidate)))) {
      return extra;
    }
  }

  return null;
}

export function findMatchingModifier(item: MenuItem, rawModifier: string): MenuModifier | null {
  const query = normalizeText(rawModifier);

  for (const modifier of item.modifiers) {
    const candidates = [modifier.name, ...(modifier.aliases ?? [])];
    if (candidates.some((candidate) => normalizeText(candidate) === query)) {
      return modifier;
    }
  }

  for (const modifier of item.modifiers) {
    const candidates = [modifier.name, ...(modifier.aliases ?? [])];
    if (candidates.some((candidate) => normalizeText(candidate).includes(query) || query.includes(normalizeText(candidate)))) {
      return modifier;
    }
  }

  return null;
}

export function formatMenu(): string {
  return [
    "Menu:",
    ...sushiMenu.map((item) => {
      const description = item.description ? ` - ${item.description}` : "";
      return `- ${item.name} - $${item.price}${description}`;
    }),
  ].join("\n");
}
