import { findMenuItemByName, findMatchingExtra, findMatchingModifier, normalizeText } from "../menu/sushi-menu";

export type CartItem = {
  name: string;
  basePrice: number;
  quantity: number;
  extras: Array<{ name: string; price: number }>;
  modifiers: string[];
};

export type CartState = {
  items: CartItem[];
};

export function createEmptyCart(): CartState {
  return { items: [] };
}

export function getCartLineTotal(item: CartItem): number {
  const extrasTotal = item.extras.reduce((sum, extra) => sum + extra.price, 0);
  return (item.basePrice + extrasTotal) * item.quantity;
}

export function getCartTotal(cart: CartState): number {
  return cart.items.reduce((sum, item) => sum + getCartLineTotal(item), 0);
}

export function clearCart(): CartState {
  return { items: [] };
}

function extrasMatch(left: CartItem["extras"], right: CartItem["extras"]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((extra, index) => extra.name === right[index]?.name && extra.price === right[index]?.price);
}

function modifiersMatch(left: CartItem["modifiers"], right: CartItem["modifiers"]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((modifier, index) => modifier === right[index]);
}

export function addItemToCart(
  cart: CartState,
  input: { name: string; quantity?: number; extras?: string[]; modifiers?: string[] },
): { cart: CartState; addedItem: CartItem | null } {
  const menuItem = findMenuItemByName(input.name);

  if (!menuItem) {
    return { cart, addedItem: null };
  }

  const extras = (input.extras ?? [])
    .map((extraName) => findMatchingExtra(menuItem, extraName))
    .filter((extra): extra is NonNullable<typeof extra> => extra !== null)
    .map((extra) => ({ name: extra.name, price: extra.price }));

  const modifiers = (input.modifiers ?? [])
    .map((modifierName) => findMatchingModifier(menuItem, modifierName))
    .filter((modifier): modifier is NonNullable<typeof modifier> => modifier !== null)
    .map((modifier) => modifier.name);

  const addedItem: CartItem = {
    name: menuItem.name,
    basePrice: menuItem.price,
    quantity: Math.max(1, input.quantity ?? 1),
    extras,
    modifiers,
  };

  const existingItemIndex = cart.items.findIndex(
    (item) =>
      item.name === addedItem.name &&
      item.basePrice === addedItem.basePrice &&
      extrasMatch(item.extras, addedItem.extras) &&
      modifiersMatch(item.modifiers, addedItem.modifiers),
  );

  if (existingItemIndex >= 0) {
    const nextItems = cart.items.map((item, index) =>
      index === existingItemIndex
        ? {
            ...item,
            quantity: item.quantity + addedItem.quantity,
          }
        : item,
    );

    const updatedItem = nextItems[existingItemIndex] ?? null;
    const nextCart = { items: nextItems };
    console.log("CART AFTER ADD:", nextCart);

    return {
      cart: nextCart,
      addedItem: updatedItem,
    };
  }

  const nextCart = {
    items: [...cart.items, addedItem],
  };
  console.log("CART AFTER ADD:", nextCart);

  return {
    cart: nextCart,
    addedItem,
  };
}

export function removeItemFromCart(cart: CartState, options: { index?: number | null; name?: string | null }): { cart: CartState; removedItem: CartItem | null } {
  if (typeof options.index === "number" && Number.isFinite(options.index)) {
    const position = options.index - 1;
    if (position >= 0 && position < cart.items.length) {
      const removedItem = cart.items[position] ?? null;
      return {
        cart: {
          items: cart.items.filter((_, currentIndex) => currentIndex !== position),
        },
        removedItem,
      };
    }
  }

  if (options.name) {
    const query = normalizeText(options.name);
    const itemIndex = cart.items.findIndex((item) => {
      const normalizedName = normalizeText(item.name);
      return normalizedName === query || normalizedName.includes(query) || query.includes(normalizedName);
    });

    if (itemIndex >= 0) {
      const removedItem = cart.items[itemIndex] ?? null;
      return {
        cart: {
          items: cart.items.filter((_, currentIndex) => currentIndex !== itemIndex),
        },
        removedItem,
      };
    }
  }

  return { cart, removedItem: null };
}

export function formatCart(cart: CartState): string {
  if (cart.items.length === 0) {
    return "Tu carrito esta vacio.";
  }

  const lines: string[] = ["Tu carrito:"];

  cart.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name} x${item.quantity} - $${getCartLineTotal(item)}`);

    item.extras.forEach((extra) => {
      lines.push(`   + extra ${extra.name} (+$${extra.price})`);
    });

    item.modifiers.forEach((modifier) => {
      lines.push(`   - ${modifier}`);
    });
  });

  lines.push("");
  lines.push(`Total: $${getCartTotal(cart)}`);

  return lines.join("\n");
}
