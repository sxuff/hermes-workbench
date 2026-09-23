// Cart pricing for the storefront checkout.

export function lineTotal(item) {
  return item.price * item.quantity;
}

export function cartTotal(items, { taxRate = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const tax = subtotal * taxRate;
  return Math.round((subtotal + tax) * 100) / 100;
}
