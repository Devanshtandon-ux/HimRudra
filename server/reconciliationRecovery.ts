import { calculateCartTotals, validateCheckoutForm } from '../src/lib/commerce.ts';
import type {
  CartItem,
  Coupon,
  Order,
  PaymentMethod,
  PersistedCheckoutDraft,
  Product,
  Promotion,
  ShippingAddress,
  StoreSettings,
} from '../src/types.ts';
import type { PaymentIntentRecord, StoredUser } from './store.ts';
import type { RazorpayOrderEntity, RazorpayPaymentEntity } from './razorpay.ts';

export type RecoveryFieldSource =
  | 'payment_intent'
  | 'razorpay_order_notes'
  | 'razorpay_payment_notes'
  | 'customer_profile'
  | 'saved_address'
  | 'previous_order'
  | 'razorpay_payment'
  | 'exact_catalog_match';

export interface CheckedRecoverySource {
  source:
    | 'payment_intent'
    | 'razorpay_order_notes'
    | 'razorpay_payment_notes'
    | 'customer_profile'
    | 'saved_address'
    | 'previous_order'
    | 'catalog_amount_match';
  found: boolean;
  detail: string;
}

export interface RecoveredCheckoutResult {
  canAutoReconcile: boolean;
  complete: boolean;
  draft: PersistedCheckoutDraft | null;
  partialAddress: Partial<ShippingAddress>;
  items: CartItem[];
  itemsSource?: RecoveryFieldSource;
  shippingSpeed: 'standard' | 'express';
  couponCode?: string;
  deliveryInstructions?: string;
  matchedUserId?: string;
  matchedUserName?: string;
  matchedUserEmail?: string;
  fieldSources: Partial<Record<keyof ShippingAddress | 'items', RecoveryFieldSource>>;
  missingFields: string[];
  checkedSources: CheckedRecoverySource[];
  ambiguityWarning?: string;
  amountMatches: boolean;
  calculatedTotalPaise?: number;
}

type RequiredShippingField =
  | 'fullName'
  | 'email'
  | 'phone'
  | 'line1'
  | 'city'
  | 'state'
  | 'pincode';

const REQUIRED_ADDRESS_FIELDS: RequiredShippingField[] = [
  'fullName',
  'email',
  'phone',
  'line1',
  'city',
  'state',
  'pincode',
];

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown): string {
  return cleanText(value).toLowerCase();
}

export function normalizeIndianPhone10(value: unknown): string {
  const digits = cleanText(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function normalizeNotesObject(
  raw: Record<string, string> | unknown[] | undefined | null
): Record<string, string> {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim()) {
      result[k.trim().toLowerCase()] = v.trim();
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      result[k.trim().toLowerCase()] = String(v);
    }
  }
  return result;
}

function pickNote(notes: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const val = notes[key.toLowerCase()];
    if (val) return val;
  }
  return '';
}

function parseAddressFromNotes(notes: Record<string, string>): Partial<ShippingAddress> {
  const address: Partial<ShippingAddress> = {};
  const fullName = pickNote(notes, ['customer_name', 'full_name', 'fullname', 'name', 'shipping_name']);
  const email = normalizeEmail(pickNote(notes, ['customer_email', 'email', 'shipping_email']));
  const phone = normalizeIndianPhone10(
    pickNote(notes, ['customer_phone', 'phone', 'contact', 'mobile', 'shipping_phone'])
  );
  const houseFlatNumber = pickNote(notes, [
    'house_flat_number',
    'house_no',
    'flat_no',
    'house',
    'apartment',
  ]);
  const line1 = pickNote(notes, [
    'shipping_line1',
    'address_line1',
    'address_line_1',
    'line1',
    'street',
    'address',
    'shipping_address',
  ]);
  const line2 = pickNote(notes, ['shipping_line2', 'address_line2', 'address_line_2', 'line2']);
  const landmark = pickNote(notes, ['landmark', 'shipping_landmark']);
  const city = pickNote(notes, ['city', 'shipping_city']);
  const state = pickNote(notes, ['state', 'shipping_state']);
  const pincode = pickNote(notes, ['pincode', 'pin_code', 'postal_code', 'zip', 'shipping_pincode']).replace(
    /\D/g,
    ''
  );

  if (fullName) address.fullName = fullName;
  if (email) address.email = email;
  if (phone) address.phone = phone;
  if (houseFlatNumber) address.houseFlatNumber = houseFlatNumber;
  if (line1) address.line1 = line1;
  if (line2) address.line2 = line2;
  if (landmark) address.landmark = landmark;
  if (city) address.city = city;
  if (state) address.state = state;
  if (pincode) address.pincode = pincode;

  return address;
}

function parseItemsFromNotes(notes: Record<string, string>, products: Product[]): CartItem[] {
  const matchProductId = (token: string): string | null => {
    const normalized = token.trim().toLowerCase();
    if (!normalized) return null;
    const found = products.find(
      (p) =>
        p.id.toLowerCase() === normalized ||
        p.sku.toLowerCase() === normalized ||
        p.slug.toLowerCase() === normalized
    );
    return found?.id ?? null;
  };

  // Format 1: JSON array or compact "productId:qty,productId2:qty"
  const rawItems = pickNote(notes, ['items', 'cart_items', 'cart']);
  if (rawItems) {
    if (rawItems.startsWith('[')) {
      try {
        const parsed = JSON.parse(rawItems) as unknown;
        if (Array.isArray(parsed)) {
          const valid: CartItem[] = [];
          for (const entry of parsed) {
            if (!entry || typeof entry !== 'object') continue;
            const rec = entry as Record<string, unknown>;
            const id = matchProductId(String(rec.productId ?? rec.id ?? rec.sku ?? ''));
            const qty = Math.floor(Number(rec.quantity ?? rec.qty ?? 0));
            if (id && qty > 0 && qty <= 50) {
              valid.push({ productId: id, quantity: qty });
            }
          }
          if (valid.length > 0) return valid;
        }
      } catch {
        // fall through to compact parser
      }
    }

    const parts = rawItems
      .split(/[,;|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedCompact: CartItem[] = [];
    for (const part of parts) {
      const [rawId, rawQty] = part.split(/[:x*]/i);
      const productId = matchProductId(rawId || '');
      const qty = rawQty ? Math.floor(Number(rawQty)) : 1;
      if (productId && Number.isFinite(qty) && qty > 0 && qty <= 50) {
        parsedCompact.push({ productId, quantity: qty });
      }
    }
    if (parsedCompact.length > 0) return parsedCompact;
  }

  // Format 2: Single product_id / sku + quantity
  const singleProductToken = pickNote(notes, ['product_id', 'productid', 'sku', 'product_sku']);
  if (singleProductToken) {
    const productId = matchProductId(singleProductToken);
    const qty = Math.floor(Number(pickNote(notes, ['quantity', 'qty']) || '1'));
    if (productId && Number.isFinite(qty) && qty > 0 && qty <= 50) {
      return [{ productId, quantity: qty }];
    }
  }

  return [];
}

function isLikelyTestOrder(order: Order): boolean {
  const haystack = [
    order.orderNumber,
    order.customerName,
    order.customerEmail,
    order.shippingAddress?.line1,
    order.shippingAddress?.city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    order.status === 'Cancelled' ||
    /\b(test|dummy|smoke|sandbox)\b/.test(haystack) ||
    order.customerEmail.toLowerCase().endsWith('@example.com')
  );
}

/**
 * Resolves verified customer shipping details and cart items across all persisted sources
 * without ever inventing or guessing missing fields.
 */
export function recoverVerifiedCheckoutDetails(params: {
  livePayment: RazorpayPaymentEntity;
  liveOrder?: RazorpayOrderEntity | null;
  storedIntent?: PaymentIntentRecord | null;
  allPaymentIntents?: PaymentIntentRecord[];
  users: StoredUser[];
  orders: Order[];
  products: Product[];
  settings: StoreSettings;
  coupons: Coupon[];
  promotions: Promotion[];
  verifiedMethod: PaymentMethod;
}): RecoveredCheckoutResult {
  const {
    livePayment,
    liveOrder,
    storedIntent,
    allPaymentIntents = [],
    users,
    orders,
    products,
    settings,
    coupons,
    promotions,
    verifiedMethod,
  } = params;

  const checkedSources: CheckedRecoverySource[] = [];
  const fieldSources: Partial<Record<keyof ShippingAddress | 'items', RecoveryFieldSource>> = {};
  const partialAddress: Partial<ShippingAddress> = {};

  const applyAddressField = (
    field: keyof ShippingAddress,
    rawValue: unknown,
    source: RecoveryFieldSource
  ) => {
    if (partialAddress[field]) return;
    let cleaned = cleanText(rawValue);
    if (!cleaned) return;
    if (field === 'email') cleaned = normalizeEmail(cleaned);
    if (field === 'phone') cleaned = normalizeIndianPhone10(cleaned);
    if (field === 'pincode') cleaned = cleaned.replace(/\D/g, '');
    if (!cleaned) return;
    partialAddress[field] = cleaned;
    fieldSources[field] = source;
  };

  const applyAddressObject = (
    addr: Partial<ShippingAddress> | undefined | null,
    source: RecoveryFieldSource
  ) => {
    if (!addr) return;
    applyAddressField('fullName', addr.fullName, source);
    applyAddressField('email', addr.email, source);
    applyAddressField('phone', addr.phone, source);
    applyAddressField('houseFlatNumber', addr.houseFlatNumber, source);
    applyAddressField('line1', addr.line1, source);
    applyAddressField('line2', addr.line2, source);
    applyAddressField('landmark', addr.landmark, source);
    applyAddressField('city', addr.city, source);
    applyAddressField('state', addr.state, source);
    applyAddressField('pincode', addr.pincode, source);
  };

  const amountPaise = typeof livePayment.amount === 'number' ? Math.round(livePayment.amount) : 0;
  const paymentTimestampMs = livePayment.created_at
    ? livePayment.created_at * 1000
    : storedIntent?.createdAt
    ? Date.parse(storedIntent.createdAt) || Date.now()
    : Date.now();

  let items: CartItem[] = [];
  let itemsSource: RecoveryFieldSource | undefined;
  let shippingSpeed: 'standard' | 'express' = 'standard';
  let couponCode: string | undefined;
  let deliveryInstructions: string | undefined;
  let matchedUserId: string | undefined;

  // 1. Existing payment_intent (matched by razorpayOrderId or razorpayPaymentId)
  const effectiveIntent =
    storedIntent ||
    allPaymentIntents.find(
      (i) =>
        (livePayment.order_id && i.razorpayOrderId === livePayment.order_id) ||
        (livePayment.id && i.paymentId === livePayment.id)
    ) ||
    null;

  if (effectiveIntent?.checkoutPayload) {
    const payload = effectiveIntent.checkoutPayload;
    applyAddressObject(payload.shippingAddress, 'payment_intent');
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      items = payload.items.map((it) => ({ productId: it.productId, quantity: it.quantity }));
      itemsSource = 'payment_intent';
      fieldSources.items = 'payment_intent';
    }
    shippingSpeed = payload.shippingSpeed === 'express' ? 'express' : 'standard';
    if (payload.couponCode) couponCode = payload.couponCode;
    if (payload.deliveryInstructions) deliveryInstructions = payload.deliveryInstructions;
    if (payload.userId) matchedUserId = payload.userId;
    checkedSources.push({
      source: 'payment_intent',
      found: true,
      detail: `Found payment intent (${effectiveIntent.razorpayOrderId}) with persisted checkout draft.`,
    });
  } else if (effectiveIntent) {
    checkedSources.push({
      source: 'payment_intent',
      found: false,
      detail: `Payment intent (${effectiveIntent.razorpayOrderId}) exists, but checkout_payload is empty (historical checkout).`,
    });
  } else {
    checkedSources.push({
      source: 'payment_intent',
      found: false,
      detail: 'No matching payment_intent record found in database.',
    });
  }

  // 2. Razorpay Order Notes (GET /v1/orders/:order_id)
  const orderNotes = normalizeNotesObject(liveOrder?.notes);
  const orderNoteAddress = parseAddressFromNotes(orderNotes);
  const orderNoteItems = parseItemsFromNotes(orderNotes, products);
  const hasOrderNoteData =
    Object.keys(orderNoteAddress).length > 0 || orderNoteItems.length > 0;
  if (hasOrderNoteData) {
    applyAddressObject(orderNoteAddress, 'razorpay_order_notes');
    if (items.length === 0 && orderNoteItems.length > 0) {
      items = orderNoteItems;
      itemsSource = 'razorpay_order_notes';
      fieldSources.items = 'razorpay_order_notes';
    }
    const noteSpeed = pickNote(orderNotes, ['shipping_speed', 'shippingspeed']);
    if (noteSpeed === 'express') shippingSpeed = 'express';
    const noteCoupon = pickNote(orderNotes, ['coupon', 'coupon_code', 'couponcode']);
    if (!couponCode && noteCoupon) couponCode = noteCoupon;
    const noteInstructions = pickNote(orderNotes, ['delivery_instructions', 'instructions']);
    if (!deliveryInstructions && noteInstructions) deliveryInstructions = noteInstructions;
  }
  const orderNoteUserId = pickNote(orderNotes, ['user_id', 'userid', 'customer_id']);
  if (!matchedUserId && orderNoteUserId) matchedUserId = orderNoteUserId;
  const orderNoteKeys = Object.keys(orderNotes);
  checkedSources.push({
    source: 'razorpay_order_notes',
    found: hasOrderNoteData,
    detail: !liveOrder
      ? 'Razorpay order details could not be loaded.'
      : hasOrderNoteData
      ? `Recovered checkout fields from Razorpay order notes (${orderNoteKeys.join(', ')}).`
      : orderNoteKeys.length > 0
      ? `Razorpay order notes only contain metadata keys (${orderNoteKeys.join(', ')}), with no customer shipping address or cart items.`
      : 'Razorpay order has no notes.',
  });

  // 3. Razorpay Payment Notes & direct payment email/contact
  const paymentNotes = normalizeNotesObject(livePayment.notes);
  const paymentNoteAddress = parseAddressFromNotes(paymentNotes);
  const paymentNoteItems = parseItemsFromNotes(paymentNotes, products);
  const hasPaymentNoteData =
    Object.keys(paymentNoteAddress).length > 0 || paymentNoteItems.length > 0;
  if (hasPaymentNoteData) {
    applyAddressObject(paymentNoteAddress, 'razorpay_payment_notes');
    if (items.length === 0 && paymentNoteItems.length > 0) {
      items = paymentNoteItems;
      itemsSource = 'razorpay_payment_notes';
      fieldSources.items = 'razorpay_payment_notes';
    }
  }
  const paymentNoteUserId = pickNote(paymentNotes, ['user_id', 'userid', 'customer_id']);
  if (!matchedUserId && paymentNoteUserId) matchedUserId = paymentNoteUserId;
  const paymentNoteKeys = Object.keys(paymentNotes);
  checkedSources.push({
    source: 'razorpay_payment_notes',
    found: hasPaymentNoteData,
    detail: hasPaymentNoteData
      ? `Recovered fields from Razorpay payment notes (${paymentNoteKeys.join(', ')}).`
      : paymentNoteKeys.length > 0
      ? `Razorpay payment notes only contain keys (${paymentNoteKeys.join(', ')}), with no customer shipping address.`
      : 'Razorpay payment has no notes.',
  });

  // 4. Customer Profile & Saved Default Address (users table)
  const lookupEmail = normalizeEmail(partialAddress.email || livePayment.email);
  const lookupPhone = normalizeIndianPhone10(partialAddress.phone || livePayment.contact);

  let matchedUser: StoredUser | null = null;
  let ambiguityWarning: string | undefined;

  if (matchedUserId) {
    matchedUser = users.find((u) => u.id === matchedUserId) ?? null;
  }
  if (!matchedUser && lookupEmail) {
    const emailMatches = users.filter((u) => normalizeEmail(u.email) === lookupEmail);
    if (emailMatches.length === 1) {
      matchedUser = emailMatches[0];
    } else if (emailMatches.length > 1) {
      ambiguityWarning = `Multiple user profiles share email ${lookupEmail}; manual confirmation required.`;
    }
  }
  if (!matchedUser && !ambiguityWarning && lookupPhone && lookupPhone.length === 10) {
    const phoneMatches = users.filter(
      (u) =>
        normalizeIndianPhone10(u.phone) === lookupPhone ||
        normalizeIndianPhone10(u.defaultAddress?.phone) === lookupPhone
    );
    if (phoneMatches.length === 1) {
      matchedUser = phoneMatches[0];
    } else if (phoneMatches.length > 1) {
      ambiguityWarning = `Multiple user profiles share phone ${lookupPhone}; manual confirmation required.`;
    }
  }

  if (matchedUser) {
    matchedUserId = matchedUser.id;
    applyAddressField('fullName', matchedUser.defaultAddress?.fullName || matchedUser.name, 'customer_profile');
    applyAddressField('email', matchedUser.defaultAddress?.email || matchedUser.email, 'customer_profile');
    applyAddressField('phone', matchedUser.defaultAddress?.phone || matchedUser.phone, 'customer_profile');
    checkedSources.push({
      source: 'customer_profile',
      found: true,
      detail: `Matched registered customer profile (${matchedUser.name}, ${matchedUser.email}).`,
    });

    if (matchedUser.defaultAddress) {
      applyAddressObject(matchedUser.defaultAddress, 'saved_address');
      const hasAddressCore = Boolean(
        cleanText(matchedUser.defaultAddress.line1) &&
          cleanText(matchedUser.defaultAddress.city) &&
          cleanText(matchedUser.defaultAddress.state) &&
          cleanText(matchedUser.defaultAddress.pincode)
      );
      checkedSources.push({
        source: 'saved_address',
        found: hasAddressCore,
        detail: hasAddressCore
          ? `Recovered saved default address (${matchedUser.defaultAddress.city}, ${matchedUser.defaultAddress.state} ${matchedUser.defaultAddress.pincode}).`
          : 'Customer profile has a partial saved default address.',
      });
    } else {
      checkedSources.push({
        source: 'saved_address',
        found: false,
        detail: 'Matched customer profile has no saved default address.',
      });
    }
  } else {
    checkedSources.push({
      source: 'customer_profile',
      found: false,
      detail: ambiguityWarning
        ? ambiguityWarning
        : lookupEmail || lookupPhone
        ? `No registered customer profile matches ${[lookupEmail, lookupPhone].filter(Boolean).join(' / ')}.`
        : 'Razorpay payment has neither email nor phone to match a customer profile.',
    });
    checkedSources.push({
      source: 'saved_address',
      found: false,
      detail: 'No saved customer address available.',
    });
  }

  // 5. Previous verified customer orders (fallback for missing shipping address fields)
  const missingBeforeOrders = REQUIRED_ADDRESS_FIELDS.filter((f) => !partialAddress[f]);
  if (missingBeforeOrders.length > 0 && !ambiguityWarning) {
    const candidateOrders = orders
      .filter((o) => !isLikelyTestOrder(o))
      .filter((o) => {
        if (matchedUserId && o.userId && o.userId === matchedUserId) return true;
        if (lookupEmail && normalizeEmail(o.customerEmail) === lookupEmail) return true;
        if (
          lookupPhone &&
          lookupPhone.length === 10 &&
          (normalizeIndianPhone10(o.customerPhone) === lookupPhone ||
            normalizeIndianPhone10(o.shippingAddress?.phone) === lookupPhone)
        ) {
          return true;
        }
        return false;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    if (candidateOrders.length > 0) {
      const latestOrder = candidateOrders[0];
      // Verify all matched orders belong to the same email/customer if no matchedUserId
      const distinctEmails = new Set(
        candidateOrders.map((o) => normalizeEmail(o.customerEmail)).filter(Boolean)
      );
      if (!matchedUserId && distinctEmails.size > 1) {
        ambiguityWarning =
          'Multiple prior orders with different customer emails share this phone number; manual confirmation required.';
        checkedSources.push({
          source: 'previous_order',
          found: false,
          detail: ambiguityWarning,
        });
      } else {
        applyAddressObject(latestOrder.shippingAddress, 'previous_order');
        if (!matchedUserId && latestOrder.userId) {
          matchedUserId = latestOrder.userId;
        }
        checkedSources.push({
          source: 'previous_order',
          found: true,
          detail: `Recovered verified shipping details from prior order ${latestOrder.orderNumber}.`,
        });
      }
    } else {
      checkedSources.push({
        source: 'previous_order',
        found: false,
        detail: 'No prior customer orders found for this email or phone.',
      });
    }
  } else if (missingBeforeOrders.length === 0) {
    checkedSources.push({
      source: 'previous_order',
      found: false,
      detail: 'Skipped — complete shipping details already recovered from higher-priority source.',
    });
  }

  // 6. Direct Razorpay payment email / contact (never fabricates name or street address)
  applyAddressField('email', livePayment.email, 'razorpay_payment');
  applyAddressField('phone', livePayment.contact, 'razorpay_payment');

  // 7. Cart items: if not recovered from payment_intent or Razorpay notes, check for a strictly unique single-SKU active catalog match
  if (items.length === 0 && amountPaise >= 100) {
    const activeProducts = products.filter((p) => p.active);
    const exactMatches: Array<{ items: CartItem[]; productName: string; qty: number }> = [];

    for (const prod of activeProducts) {
      for (let qty = 1; qty <= 10; qty += 1) {
        const candidateItems: CartItem[] = [{ productId: prod.id, quantity: qty }];
        const calc = calculateCartTotals(candidateItems, products, settings, {
          shippingSpeed,
          paymentMethod: verifiedMethod,
          couponCode,
          coupons,
          promotions,
          nowMs: paymentTimestampMs,
        });
        if (Math.round(calc.grandTotal * 100) === amountPaise) {
          exactMatches.push({ items: candidateItems, productName: prod.name, qty });
        }
      }
    }

    if (exactMatches.length === 1) {
      items = exactMatches[0].items;
      itemsSource = 'exact_catalog_match';
      fieldSources.items = 'exact_catalog_match';
      checkedSources.push({
        source: 'catalog_amount_match',
        found: true,
        detail: `Exact unambiguous catalog match for ₹${(amountPaise / 100).toFixed(2)}: ${exactMatches[0].qty} × ${exactMatches[0].productName}.`,
      });
    } else if (exactMatches.length > 1) {
      checkedSources.push({
        source: 'catalog_amount_match',
        found: false,
        detail: `Multiple product combinations match ₹${(amountPaise / 100).toFixed(2)}; manual item confirmation required.`,
      });
    } else {
      checkedSources.push({
        source: 'catalog_amount_match',
        found: false,
        detail: `No single active product matches ₹${(amountPaise / 100).toFixed(2)} without a coupon or multi-item cart.`,
      });
    }
  } else if (items.length > 0) {
    checkedSources.push({
      source: 'catalog_amount_match',
      found: true,
      detail: `Cart items already recovered from ${itemsSource}.`,
    });
  }

  // Validate recovered shipping address strictly — never invent defaults
  const candidateAddress: ShippingAddress = {
    fullName: partialAddress.fullName || '',
    email: partialAddress.email || '',
    phone: partialAddress.phone || '',
    houseFlatNumber: partialAddress.houseFlatNumber || undefined,
    line1: partialAddress.line1 || '',
    line2: partialAddress.line2 || undefined,
    landmark: partialAddress.landmark || undefined,
    city: partialAddress.city || '',
    state: partialAddress.state || '',
    pincode: partialAddress.pincode || '',
  };

  const validation = validateCheckoutForm(candidateAddress);
  const missingFields: string[] = [];

  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!partialAddress[field] || validation.errors[field]) {
      missingFields.push(field);
    }
  }
  if (items.length === 0) {
    missingFields.push('items');
  }

  let amountMatches = false;
  let calculatedTotalPaise: number | undefined;
  if (items.length > 0) {
    const calc = calculateCartTotals(items, products, settings, {
      shippingSpeed,
      paymentMethod: verifiedMethod,
      couponCode,
      coupons,
      promotions,
      nowMs: paymentTimestampMs,
    });
    calculatedTotalPaise = Math.round(calc.grandTotal * 100);
    amountMatches = calculatedTotalPaise === amountPaise;
    if (!amountMatches) {
      missingFields.push('amountMismatch');
    }
  }

  const complete =
    validation.valid && items.length > 0 && amountMatches && !ambiguityWarning;

  const draft: PersistedCheckoutDraft | null = complete
    ? {
        items,
        shippingAddress: candidateAddress,
        deliveryInstructions,
        shippingSpeed,
        paymentMethod: verifiedMethod,
        couponCode,
        userId: matchedUserId,
      }
    : null;

  return {
    canAutoReconcile: complete,
    complete,
    draft,
    partialAddress,
    items,
    itemsSource,
    shippingSpeed,
    couponCode,
    deliveryInstructions,
    matchedUserId,
    matchedUserName: matchedUser?.name,
    matchedUserEmail: matchedUser?.email,
    fieldSources,
    missingFields,
    checkedSources,
    ambiguityWarning,
    amountMatches,
    calculatedTotalPaise,
  };
}

/**
 * Builds concise Razorpay Order `notes` (within Razorpay's 15-key / 256-char-per-value limits)
 * so future orders always have a secondary verified checkout recovery copy on Razorpay itself.
 */
export function buildRazorpayOrderNotes(params: {
  paymentMethod?: PaymentMethod;
  items: CartItem[];
  shippingSpeed: 'standard' | 'express';
  couponCode?: string;
  shippingAddress?: ShippingAddress;
  userId?: string;
}): Record<string, string> {
  const notes: Record<string, string> = {
    store: 'HimRudra',
    method: params.paymentMethod || 'UPI',
    shipping_speed: params.shippingSpeed,
    items: params.items
      .map((i) => `${i.productId}:${i.quantity}`)
      .join(',')
      .slice(0, 250),
  };
  if (params.couponCode?.trim()) {
    notes.coupon_code = params.couponCode.trim().slice(0, 64);
  }
  if (params.userId?.trim()) {
    notes.user_id = params.userId.trim().slice(0, 100);
  }
  if (params.shippingAddress) {
    const addr = params.shippingAddress;
    if (addr.fullName?.trim()) notes.customer_name = addr.fullName.trim().slice(0, 120);
    if (addr.email?.trim()) notes.customer_email = addr.email.trim().toLowerCase().slice(0, 120);
    if (addr.phone?.trim()) notes.customer_phone = normalizeIndianPhone10(addr.phone).slice(0, 20);
    if (addr.houseFlatNumber?.trim()) {
      notes.house_flat_number = addr.houseFlatNumber.trim().slice(0, 100);
    }
    if (addr.line1?.trim()) notes.shipping_line1 = addr.line1.trim().slice(0, 240);
    if (addr.landmark?.trim()) notes.landmark = addr.landmark.trim().slice(0, 120);
    if (addr.city?.trim()) notes.city = addr.city.trim().slice(0, 80);
    if (addr.state?.trim()) notes.state = addr.state.trim().slice(0, 80);
    if (addr.pincode?.trim()) notes.pincode = addr.pincode.trim().slice(0, 10);
  }
  return notes;
}
