import test from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';

test('totals a simple cart', () => {
  assert.equal(cartTotal([{ price: 10, quantity: 2 }]), 20);
});

test('applies tax', () => {
  assert.equal(cartTotal([{ price: 100, quantity: 1 }], { taxRate: 0.08 }), 108);
});

test('keeps cents exact when tax lands on a half cent', () => {
  const items = [{ price: 1.15, quantity: 3 }, { price: 12.5, quantity: 1 }];
  assert.equal(cartTotal(items, { taxRate: 0.1 }), 17.55);
});
