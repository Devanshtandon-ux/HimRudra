import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_SHIPPING_PROMO_END_ISO,
  calculateCartTotals,
  calculateProfitMetrics,
  getActiveFreeShippingPromotion,
  getCountdownParts,
  getOrderStageIndex,
  isAuthorizedAdmin,
  normalizeLegacyOrderStatus,
  validateCheckoutForm,
} from './commerce';
import type { Coupon, Expense, Order, Product, Promotion, StoreSettings } from '../types';

const sampleProduct: Product = {
  id: 'himrudra-shilajit-20g',
  slug: 'himalayan-shilajit-resin-20g',
  name: 'HimRudra Himalayan Shilajit Resin',
  subtitle: 'Pure by Himalayas · 20 g Jar',
  netQuantity: '20 g',
  sku: 'HR-SHJ-20G',
  hsnCode: '30049011',
  mrp: 1299,
  price: 799,
  costPerUnit: 290,
  stock: 48,
  lowStockThreshold: 10,
  batchNumber: 'HR-SHJ-2026-B04',
  gstRatePercent: 12,
  shortDescription: 'Traditional Himalayan mineral resin.',
  usageGuidance: 'Dissolve a pea-sized portion in lukewarm water.',
  storageInstructions: 'Store in a cool, dry place.',
  shippingNote: 'Standard shipping ₹79; free above ₹1,499.',
  returnPolicy: 'Unopened jars eligible within 7 days.',
  specifications: [],
  galleryTypes: ['hero', 'texture', 'ritual', 'box'],
  active: true,
};

const sampleSettings: StoreSettings = {
  standardShippingFee: 79,
  expressShippingFee: 149,
  freeShippingThreshold: 1499,
  codFee: 49,
  codEnabled: true,
  gstIncludedInPrice: true,
  gatewayFeePercent: 2,
  defaultShippingCostPerOrder: 65,
  orderNotificationEmail: 'himrudraofficial@gmail.com',
  emailNotificationsEnabled: true,
  brandEmail: 'himrudraofficial@gmail.com',
  brandPhone: '9549572457',
  brandAddress:
    'Marketed by- KP Enterprise, Office No 4-D fourth, Vardan Exclusive, Tower, Lakhudi Rd, near SARDAR PATEL STADIUM, Navrangpura, Ahmedabad, Gujarat 380009',
  announcementText: 'LIMITED-TIME OFFER — FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!',
  seoTitle: 'HimRudra',
  seoDescription: 'HimRudra',
};

const sampleCoupons: Coupon[] = [
  {
    code: 'RITUAL10',
    discountType: 'percent',
    value: 10,
    minOrderAmount: 799,
    active: true,
    description: '10% off on orders ₹799+',
  },
];

const freeShippingPromo: Promotion = {
  id: 'promo-freeship-nov26',
  title: 'November Free Shipping Festival',
  description: 'Free standard shipping on all HimRudra orders until 30 November 2026.',
  bannerHeadline: 'LIMITED-TIME OFFER — FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!',
  bannerSubtext: 'Hurry! Order Your HimRudra Shilajit Today.',
  bannerTheme: 'crystal-brown-gold',
  startsAt: '2026-11-01T00:00:00+05:30',
  endsAt: FREE_SHIPPING_PROMO_END_ISO,
  freeShipping: true,
  freeShippingSpeed: 'standard',
  discountPercent: 0,
  enabled: true,
  usageCount: 0,
  revenueGenerated: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

test('calculateCartTotals charges standard shipping below threshold when no promo active and waives above threshold', () => {
  const single = calculateCartTotals(
    [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
    [sampleProduct],
    sampleSettings,
    { shippingSpeed: 'standard', paymentMethod: 'UPI' }
  );

  assert.equal(single.itemCount, 1);
  assert.equal(single.mrpTotal, 1299);
  assert.equal(single.subtotal, 799);
  assert.equal(single.instantSavings, 500);
  assert.equal(single.discountPercent, 38);
  assert.equal(single.shippingFee, 79);
  assert.equal(single.grandTotal, 878);
  assert.equal(single.freeShippingRemaining, 700);
  assert.equal(single.freeShippingByPromo, false);

  const duo = calculateCartTotals(
    [{ productId: 'himrudra-shilajit-20g', quantity: 2 }],
    [sampleProduct],
    sampleSettings,
    { shippingSpeed: 'standard', paymentMethod: 'UPI' }
  );

  assert.equal(duo.subtotal, 1598);
  assert.equal(duo.shippingFee, 0);
  assert.equal(duo.grandTotal, 1598);
});

test('free shipping promo grants ₹0 shipping before 30 Nov 2026 23:59:59 IST and restores normal shipping after expiration', () => {
  const beforeEnd = Date.parse('2026-11-19T12:00:00+05:30');
  const duringPromo = calculateCartTotals(
    [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
    [sampleProduct],
    sampleSettings,
    {
      shippingSpeed: 'standard',
      paymentMethod: 'UPI',
      promotions: [freeShippingPromo],
      nowMs: beforeEnd,
    }
  );
  assert.equal(duringPromo.shippingFee, 0);
  assert.equal(duringPromo.freeShippingByPromo, true);
  assert.equal(duringPromo.grandTotal, 799);
  assert.ok(getActiveFreeShippingPromotion([freeShippingPromo], beforeEnd));

  const afterEnd = Date.parse('2026-12-01T00:00:01+05:30');
  const afterPromo = calculateCartTotals(
    [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
    [sampleProduct],
    sampleSettings,
    {
      shippingSpeed: 'standard',
      paymentMethod: 'UPI',
      promotions: [freeShippingPromo],
      nowMs: afterEnd,
    }
  );
  assert.equal(afterPromo.shippingFee, 79);
  assert.equal(afterPromo.freeShippingByPromo, false);
  assert.equal(afterPromo.grandTotal, 878);
  assert.equal(getActiveFreeShippingPromotion([freeShippingPromo], afterEnd), undefined);
});

test('getCountdownParts returns accurate remaining Days/Hours/Minutes/Seconds in IST and marks expired afterward', () => {
  const exactOneDayBefore = Date.parse('2026-11-29T23:59:59+05:30');
  const active = getCountdownParts(FREE_SHIPPING_PROMO_END_ISO, exactOneDayBefore);
  assert.equal(active.expired, false);
  assert.equal(active.days, 1);
  assert.equal(active.hours, 0);
  assert.equal(active.minutes, 0);
  assert.equal(active.seconds, 0);

  const expired = getCountdownParts(
    FREE_SHIPPING_PROMO_END_ISO,
    Date.parse('2026-12-01T00:00:05+05:30')
  );
  assert.equal(expired.expired, true);
});

test('calculateCartTotals applies coupon and COD fee accurately', () => {
  const withCouponAndCod = calculateCartTotals(
    [{ productId: 'himrudra-shilajit-20g', quantity: 1 }],
    [sampleProduct],
    sampleSettings,
    {
      shippingSpeed: 'standard',
      paymentMethod: 'COD',
      couponCode: 'ritual10',
      coupons: sampleCoupons,
    }
  );

  assert.equal(withCouponAndCod.couponDiscount, 80);
  assert.equal(withCouponAndCod.shippingFee, 79);
  assert.equal(withCouponAndCod.codFee, 49);
  assert.equal(withCouponAndCod.grandTotal, 799 - 80 + 79 + 49);
});

test('validateCheckoutForm rejects invalid Indian phone and PIN code and accepts valid details', () => {
  const invalid = validateCheckoutForm({
    fullName: 'A',
    phone: '12345',
    email: 'bad-email',
    line1: '12',
    city: '',
    state: '',
    pincode: '012345',
  });

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.fullName);
  assert.ok(invalid.errors.phone);
  assert.ok(invalid.errors.email);
  assert.ok(invalid.errors.pincode);

  const valid = validateCheckoutForm({
    fullName: 'Aarav Mehta',
    phone: '9876543210',
    email: 'aarav@example.in',
    houseFlatNumber: '42',
    line1: 'Rajpur Road, Jakhan',
    landmark: 'Near Silver City Mall',
    city: 'Dehradun',
    state: 'Uttarakhand',
    pincode: '248001',
  });

  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, {});
});

test('calculateProfitMetrics excludes cancelled/refunded orders from gross revenue, tracks gateway & shipping costs, and computes net profit', () => {
  const nowMs = Date.parse('2026-11-19T15:00:00+05:30');
  const orders: Order[] = [
    {
      id: '1',
      orderNumber: 'HIM-2026-0001',
      customerName: 'Aarav',
      customerEmail: 'a@b.in',
      customerPhone: '9876543210',
      shippingAddress: {
        fullName: 'Aarav',
        phone: '9876543210',
        email: 'a@b.in',
        line1: 'Street 1',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
      },
      items: [
        {
          productId: 'himrudra-shilajit-20g',
          name: 'HimRudra',
          sku: 'HR-SHJ-20G',
          netQuantity: '20 g',
          quantity: 2,
          unitPrice: 799,
          unitMrp: 1299,
          unitCost: 290,
          batchNumber: 'HR-SHJ-2026-B04',
        },
      ],
      subtotal: 1598,
      mrpTotal: 2598,
      instantSavings: 1000,
      couponDiscount: 0,
      shippingFee: 0,
      shippingSpeed: 'standard',
      codFee: 0,
      taxableValue: 1426.79,
      gstAmount: 171.21,
      totalAmount: 1598,
      gatewayFeeAmount: 32,
      actualShippingCost: 65,
      paymentMethod: 'UPI',
      paymentStatus: 'Paid',
      status: 'Delivered',
      timeline: [],
      createdAt: '2026-11-19T08:00:00.000Z',
    },
    {
      id: '2',
      orderNumber: 'HIM-2026-0002',
      customerName: 'Cancelled',
      customerEmail: 'c@b.in',
      customerPhone: '9876543210',
      shippingAddress: {
        fullName: 'C',
        phone: '9876543210',
        email: 'c@b.in',
        line1: 'Street 2',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
      },
      items: [],
      subtotal: 799,
      mrpTotal: 1299,
      instantSavings: 500,
      couponDiscount: 0,
      shippingFee: 79,
      shippingSpeed: 'standard',
      codFee: 0,
      taxableValue: 713,
      gstAmount: 86,
      totalAmount: 878,
      paymentMethod: 'UPI',
      paymentStatus: 'Failed',
      status: 'Cancelled',
      timeline: [],
      createdAt: '2026-10-16T10:00:00Z',
    },
    {
      id: '3',
      orderNumber: 'HIM-2026-0003',
      customerName: 'Refunded Customer',
      customerEmail: 'r@b.in',
      customerPhone: '9876543210',
      shippingAddress: {
        fullName: 'R',
        phone: '9876543210',
        email: 'r@b.in',
        line1: 'Street 3',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
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
      refundAmount: 799,
      paymentMethod: 'UPI',
      paymentStatus: 'Refunded',
      status: 'Refunded',
      timeline: [],
      createdAt: '2026-11-10T10:00:00Z',
    },
  ];

  const expenses: Expense[] = [
    {
      id: 'e1',
      date: '2026-11-10',
      category: 'Lab Testing',
      description: 'ICP-MS batch assay',
      amount: 400,
    },
  ];

  const summary = calculateProfitMetrics(orders, expenses, { nowMs });
  assert.equal(summary.totalOrders, 1);
  assert.equal(summary.totalPaidOrders, 1);
  assert.equal(summary.grossRevenue, 1598);
  assert.equal(summary.totalSalesToday, 1598);
  assert.equal(summary.monthlyRevenue, 1598);
  assert.equal(summary.annualRevenue, 1598);
  assert.equal(summary.totalCogs, 580);
  assert.equal(summary.shippingExpenses, 65);
  assert.equal(summary.gatewayFees, 32);
  assert.equal(summary.refundsTotal, 799);
  assert.equal(summary.operatingExpenses, 400);
  // 1598 - 580 - 65 - 32 - 400 - 799 = -278
  assert.equal(summary.netProfit, -278);
  assert.equal(getOrderStageIndex('Dispatched'), 4);
  assert.equal(getOrderStageIndex('Cancelled'), -1);
  assert.equal(normalizeLegacyOrderStatus('Shipped'), 'Dispatched');
});

test('isAuthorizedAdmin grants access strictly to the owner email with admin role', () => {
  const owner = 'himrudraofficial@gmail.com';
  assert.equal(
    isAuthorizedAdmin({ email: 'HimRudraOfficial@gmail.com', role: 'admin' }, owner),
    true
  );
  assert.equal(
    isAuthorizedAdmin({ email: 'atyansharma04488@gmail.com', role: 'admin' }, owner),
    false
  );
  assert.equal(
    isAuthorizedAdmin({ email: owner, role: 'customer' }, owner),
    false
  );
  assert.equal(isAuthorizedAdmin(null, owner), false);
});

test('calculateProfitMetrics starts cleanly at exact zero when no orders or expenses exist', () => {
  const zero = calculateProfitMetrics([], []);
  assert.equal(zero.totalOrders, 0);
  assert.equal(zero.totalPaidOrders, 0);
  assert.equal(zero.grossRevenue, 0);
  assert.equal(zero.totalSalesToday, 0);
  assert.equal(zero.monthlyRevenue, 0);
  assert.equal(zero.annualRevenue, 0);
  assert.equal(zero.totalCogs, 0);
  assert.equal(zero.totalShippingCollected, 0);
  assert.equal(zero.shippingExpenses, 0);
  assert.equal(zero.gatewayFees, 0);
  assert.equal(zero.refundsTotal, 0);
  assert.equal(zero.operatingExpenses, 0);
  assert.equal(zero.netProfit, 0);
  assert.equal(zero.profitMarginPercent, 0);
  assert.equal(zero.averageOrderValue, 0);
  assert.deepEqual(zero.dailySales, []);
  assert.deepEqual(zero.weeklyOrders, []);
  assert.deepEqual(zero.monthlySeries, []);
  assert.deepEqual(zero.annualSales, []);
  assert.deepEqual(zero.statusDistribution, []);
});

