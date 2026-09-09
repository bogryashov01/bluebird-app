export type CardBrand = 'Visa' | 'Mastercard' | 'Amex';

export interface MockCard {
  id: string;
  brand: CardBrand;
  last4: string;
  expiry: string;
  isDefault: boolean;
}

export const INITIAL_CARDS: MockCard[] = [
  { id: 'c1', brand: 'Visa', last4: '4242', expiry: '08/28', isDefault: true },
  { id: 'c2', brand: 'Mastercard', last4: '5100', expiry: '11/27', isDefault: false },
];