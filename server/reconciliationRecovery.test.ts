import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRazorpayOrderNotes,
  recoverVerifiedCheckoutDetails,
} from './reconciliationRecovery.ts';
import { fetchRazorpayOrderById } from './razorpay.ts';
import type { Order, Product, Promotion, StoreSettings } from '../src/types.ts';
import type { PaymentIntentRecord, StoredUser } from './store.ts';

const TEST_PRODUCTS: Product[] = [
  {
    id: 'himrudra-shilajit-20g',
    slug: 'himalayan-shilajit-resin-20g',
    name: 'HimRudra Himalayan Shilajit Resin',
    subtitle: '20 g Glass Apothecary Jar',
    netQuantity: '20 g',
    sku: 'HR-SHJ-20G',
    hsnCode: '30049011',
    mrp: 1299,
    price: 799,
    costPerUnit: 295,
    stock: 40,
    lowStockThreshold: 10,
    batchNumber: 'HR-SHJ-2026-B04',
    gstRatePercent: 12,
    shortDescription: 'Pure Himalayan resin',
    usageGuidance: 'Daily',
    storageInstructions: 'Cool dry place',
    shippingNote: 'Free standard shipping during launch offer',
    returnPolicy: '7 days',
    specifications: [],
    galleryTypes: ['hero'],
    active: true,
  },
  {
    id: 'himrudra-shilajit-40g-duo',
    slug: 'himalayan-shilajit-resin-twin-ritual-pack',
    name: 'HimRudra Twin Ritual Pack (2 × 20 g)',
    subtitle: '40 g Duo',
    netQuantity: '40 g',
    sku: 'HR-SHJ-40G-DUO',
    hsnCode: '30049011',
    mrp: 2598,
    price: 1499,
    costPerUnit: 560,
    stock: 20,
    lowStockThreshold: 5,
    batchNumber: 'HR-SHJ-2026-B04',
    gstRatePercent: 12,
    shortDescription: 'Twin pack',
    usageGuidance: 'Daily',
    storageInstructions: 'Cool dry place',
    shippingNote: 'Free standard shipping',
    returnPolicy: '7 days',
    specifications: [],
    galleryTypes: ['hero'],
    active: true,
  },
];

const TEST_SETTINGS: StoreSettings = {
  standardShippingFee: 100,
  expressShippingFee: 149,
  freeShippingThreshold: 0,
  codFee: 100,
  codEnabled: true,
  gstIncludedInPrice: true,
  gatewayFeePercent: 2,
  defaultShippingCostPerOrder: 65,
  orderNotificationEmail: 'himrudraofficial@gmail.com',
  emailNotificationsEnabled: true,
  brandEmail: 'himrudraofficial@gmail.com',
  brandPhone: '9549572457',
  brandAddress: 'Ahmedabad, Gujarat',
  announcementText: 'Free shipping',
  seoTitle: 'HimRudra',
  seoDescription: 'HimRudra',
};

const TEST_PROMOTIONS: Promotion[] = [
  {
    id: 'promo-launch',
    title: 'Launch Free Shipping',
    description: 'Free shipping until 30 Nov 2026',
    bannerHeadline: 'Free Shipping',
    bannerSubtext: 'On all orders',
    bannerTheme: 'espresso-gold',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-11-30T18:29:59.000Z',
    freeShipping: true,
    freeShippingSpeed: 'standard',
    discountPercent: 0,
    enabled: true,
    usageCount: 0,
    revenueGenerated: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

test('recovers complete verified details from saved customer address + exact ₹799 single-SKU catalog match for automatic reconciliation', () => {
  const user: StoredUser = {
    id: 'usr-1',
    name: 'Aarav Sharma',
    email: 'aarav.sharma@gmail.com',
    phone: '9876543210',
    role: 'customer',
    passwordHash: 'hashed',
    createdAt: '2026-10-01T10:00:00.000Z',
    wishlistProductIds: [],
    defaultAddress: {
      fullName: 'Aarav Sharma',
      email: 'aarav.sharma@gmail.com',
      phone: '9876543210',
      houseFlatNumber: 'Flat 402',
      line1: '18 MG Road, Navrangpura',
      city: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '380009',
    },
  };

  const result = recoverVerifiedCheckoutDetails({
    livePayment: {
      id: 'pay_U4m5a9iAVX2oU4',
      order_id: 'order_Hist799001',
      amount: 79900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      email: 'aarav.sharma@gmail.com',
      contact: '+919876543210',
      created_at: Math.floor(Date.parse('2026-11-20T10:00:00.000Z') / 1000),
    },
    liveOrder: {
      id: 'order_Hist799001',
      amount: 79900,
      notes: { store: 'HimRudra', method: 'UPI' },
    },
    storedIntent: {
      razorpayOrderId: 'order_Hist799001',
      amountPaise: 79900,
      verified: true,
      signatureVerified: true,
      paymentId: 'pay_U4m5a9iAVX2oU4',
      method: 'UPI',
      createdAt: '2026-11-20T10:00:00.000Z',
    },
    users: [user],
    orders: [],
    products: TEST_PRODUCTS,
    settings: TEST_SETTINGS,
    coupons: [],
    promotions: TEST_PROMOTIONS,
    verifiedMethod: 'UPI',
  });

  assert.equal(result.canAutoReconcile, true);
  assert.equal(result.complete, true);
  assert.equal(result.amountMatches, true);
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.draft?.shippingAddress.fullName, 'Aarav Sharma');
  assert.equal(result.draft?.shippingAddress.pincode, '380009');
  assert.deepEqual(result.draft?.items, [{ productId: 'himrudra-shilajit-20g', quantity: 1 }]);
  assert.equal(result.fieldSources.line1, 'saved_address');
  assert.equal(result.fieldSources.items, 'exact_catalog_match');
});

test('never invents missing customer shipping details when only Razorpay email and phone exist', () => {
  const result = recoverVerifiedCheckoutDetails({
    livePayment: {
      id: 'pay_U4m5a9iAVX2oU4',
      order_id: 'order_Hist799002',
      amount: 79900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      email: 'guest.buyer@gmail.com',
      contact: '+919811122233',
      created_at: Math.floor(Date.parse('2026-11-20T10:00:00.000Z') / 1000),
    },
    liveOrder: {
      id: 'order_Hist799002',
      amount: 79900,
      notes: { store: 'HimRudra', method: 'UPI' },
    },
    storedIntent: null,
    users: [],
    orders: [],
    products: TEST_PRODUCTS,
    settings: TEST_SETTINGS,
    coupons: [],
    promotions: TEST_PROMOTIONS,
    verifiedMethod: 'UPI',
  });

  assert.equal(result.canAutoReconcile, false);
  assert.equal(result.draft, null);
  assert.equal(result.partialAddress.email, 'guest.buyer@gmail.com');
  assert.equal(result.partialAddress.phone, '9811122233');
  assert.equal(result.partialAddress.fullName, undefined);
  assert.equal(result.partialAddress.line1, undefined);
  assert.equal(result.partialAddress.pincode, undefined);
  assert.deepEqual(result.missingFields, ['fullName', 'line1', 'city', 'state', 'pincode']);
  assert.deepEqual(result.items, [{ productId: 'himrudra-shilajit-20g', quantity: 1 }]);
});

test('recovers complete details from Razorpay order notes produced by buildRazorpayOrderNotes', () => {
  const notes = buildRazorpayOrderNotes({
    paymentMethod: 'UPI',
    items: [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
    shippingSpeed: 'standard',
    shippingAddress: {
      fullName: 'Meera Patel',
      email: 'meera.patel@gmail.com',
      phone: '9825012345',
      houseFlatNumber: 'B-12',
      line1: 'Satellite Road, Jodhpur Cross',
      landmark: 'Near Star Bazaar',
      city: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '380015',
    },
    userId: 'usr-meera',
  });

  // Respects Razorpay's strict 15-key and 256-char-per-value limits
  assert.ok(Object.keys(notes).length <= 15);
  for (const val of Object.values(notes)) {
    assert.ok(val.length <= 256);
  }

  const result = recoverVerifiedCheckoutDetails({
    livePayment: {
      id: 'pay_NotesRec001',
      order_id: 'order_NotesRec001',
      amount: 79900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      created_at: Math.floor(Date.parse('2026-11-20T10:00:00.000Z') / 1000),
    },
    liveOrder: {
      id: 'order_NotesRec001',
      amount: 79900,
      notes,
    },
    storedIntent: null,
    users: [],
    orders: [],
    products: TEST_PRODUCTS,
    settings: TEST_SETTINGS,
    coupons: [],
    promotions: TEST_PROMOTIONS,
    verifiedMethod: 'UPI',
  });

  assert.equal(result.canAutoReconcile, true);
  assert.equal(result.draft?.shippingAddress.fullName, 'Meera Patel');
  assert.equal(result.draft?.shippingAddress.city, 'Ahmedabad');
  assert.equal(result.draft?.shippingAddress.pincode, '380015');
  assert.equal(result.fieldSources.line1, 'razorpay_order_notes');
  assert.equal(result.fieldSources.items, 'razorpay_order_notes');
});

test('recovers shipping address from previous verified customer order when user profile has no saved defaultAddress', () => {
  const priorOrder: Order = {
    id: 'ord-prev-1',
    orderNumber: 'HR-2026-0001',
    userId: 'usr-2',
    customerName: 'Rohan Verma',
    customerEmail: 'rohan.verma@gmail.com',
    customerPhone: '9898112233',
    shippingAddress: {
      fullName: 'Rohan Verma',
      email: 'rohan.verma@gmail.com',
      phone: '9898112233',
      line1: '42 Rajpur Road',
      city: 'Dehradun',
      state: 'Uttarakhand',
      pincode: '248001',
    },
    items: [],
    subtotal: 799,
    mrpTotal: 1299,
    instantSavings: 500,
    couponDiscount: 0,
    shippingFee: 0,
    shippingSpeed: 'standard',
    codFee: 0,
    taxableValue: 713.39,
    gstAmount: 85.61,
    totalAmount: 799,
    paymentMethod: 'UPI',
    paymentStatus: 'Paid',
    status: 'Delivered',
    timeline: [],
    createdAt: '2026-11-10T09:00:00.000Z',
  };

  const result = recoverVerifiedCheckoutDetails({
    livePayment: {
      id: 'pay_PriorOrd001',
      order_id: 'order_PriorOrd001',
      amount: 79900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      email: 'rohan.verma@gmail.com',
      contact: '+919898112233',
      created_at: Math.floor(Date.parse('2026-11-20T10:00:00.000Z') / 1000),
    },
    liveOrder: { id: 'order_PriorOrd001', amount: 79900, notes: {} },
    storedIntent: null,
    users: [],
    orders: [priorOrder],
    products: TEST_PRODUCTS,
    settings: TEST_SETTINGS,
    coupons: [],
    promotions: TEST_PROMOTIONS,
    verifiedMethod: 'UPI',
  });

  assert.equal(result.canAutoReconcile, true);
  assert.equal(result.draft?.shippingAddress.city, 'Dehradun');
  assert.equal(result.fieldSources.line1, 'previous_order');
});

test('blocks automatic reconciliation when phone matches multiple distinct customer profiles', () => {
  const users: StoredUser[] = [
    {
      id: 'u1',
      name: 'Customer One',
      email: 'one@gmail.com',
      phone: '9898000011',
      role: 'customer',
      passwordHash: 'x',
      createdAt: '2026-10-01T00:00:00.000Z',
      wishlistProductIds: [],
      defaultAddress: {
        fullName: 'Customer One',
        email: 'one@gmail.com',
        phone: '9898000011',
        line1: 'Address One',
        city: 'Surat',
        state: 'Gujarat',
        pincode: '395007',
      },
    },
    {
      id: 'u2',
      name: 'Customer Two',
      email: 'two@gmail.com',
      phone: '9898000011',
      role: 'customer',
      passwordHash: 'x',
      createdAt: '2026-10-02T00:00:00.000Z',
      wishlistProductIds: [],
      defaultAddress: {
        fullName: 'Customer Two',
        email: 'two@gmail.com',
        phone: '9898000011',
        line1: 'Address Two',
        city: 'Vadodara',
        state: 'Gujarat',
        pincode: '390001',
      },
    },
  ];

  const result = recoverVerifiedCheckoutDetails({
    livePayment: {
      id: 'pay_Ambig001',
      order_id: 'order_Ambig001',
      amount: 79900,
      currency: 'INR',
      status: 'captured',
      method: 'upi',
      contact: '+919898000011',
      created_at: Math.floor(Date.parse('2026-11-20T10:00:00.000Z') / 1000),
    },
    liveOrder: null,
    storedIntent: null as PaymentIntentRecord | null,
    users,
    orders: [],
    products: TEST_PRODUCTS,
    settings: TEST_SETTINGS,
    coupons: [],
    promotions: TEST_PROMOTIONS,
    verifiedMethod: 'UPI',
  });

  assert.equal(result.canAutoReconcile, false);
  assert.ok(result.ambiguityWarning);
  assert.equal(result.draft, null);
});

test('fetchRazorpayOrderById parses Razorpay order notes from API response', async () => {
  const res = await fetchRazorpayOrderById({
    config: { keyId: 'rzp_test_abc', keySecret: 'secret', mode: 'test' },
    razorpayOrderId: 'order_Test123456',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          id: 'order_Test123456',
          amount: 79900,
          currency: 'INR',
          notes: { store: 'HimRudra', city: 'Ahmedabad' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.order.id, 'order_Test123456');
    assert.deepEqual(res.order.notes, { store: 'HimRudra', city: 'Ahmedabad' });
  }
});
