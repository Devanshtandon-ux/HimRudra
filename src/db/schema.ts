import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  InquiryReplyChannel,
  LabHeavyMetalResult,
  LabMicrobiologicalResult,
  OrderItem,
  OrderTimelineEvent,
  ShippingAddress,
  StoreSettings,
} from '../types.ts';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  uid: text('uid').unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull().default(''),
  role: text('role').notNull().default('customer'),
  passwordHash: text('password_hash').notNull(),
  defaultAddress: jsonb('default_address').$type<ShippingAddress | null>(),
  wishlistProductIds: jsonb('wishlist_product_ids').$type<string[]>().notNull().default([]),
  createdAt: text('created_at').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  subtitle: text('subtitle').notNull(),
  netQuantity: text('net_quantity').notNull(),
  sku: text('sku').notNull(),
  hsnCode: text('hsn_code').notNull(),
  mrp: doublePrecision('mrp').notNull(),
  price: doublePrecision('price').notNull(),
  costPerUnit: doublePrecision('cost_per_unit').notNull(),
  stock: integer('stock').notNull().default(0),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(10),
  batchNumber: text('batch_number').notNull(),
  gstRatePercent: doublePrecision('gst_rate_percent').notNull().default(12),
  shortDescription: text('short_description').notNull(),
  usageGuidance: text('usage_guidance').notNull(),
  storageInstructions: text('storage_instructions').notNull(),
  shippingNote: text('shipping_note').notNull(),
  returnPolicy: text('return_policy').notNull(),
  specifications: jsonb('specifications')
    .$type<Array<{ label: string; value: string }>>()
    .notNull()
    .default([]),
  galleryTypes: jsonb('gallery_types')
    .$type<Array<'hero' | 'texture' | 'ritual' | 'box'>>()
    .notNull()
    .default([]),
  customImages: jsonb('custom_images').$type<string[] | null>(),
  active: boolean('active').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const orders = pgTable('orders', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  orderNumber: text('order_number').notNull().unique(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone').notNull(),
  shippingAddress: jsonb('shipping_address').$type<ShippingAddress>().notNull(),
  deliveryInstructions: text('delivery_instructions'),
  items: jsonb('items').$type<OrderItem[]>().notNull(),
  subtotal: doublePrecision('subtotal').notNull(),
  mrpTotal: doublePrecision('mrp_total').notNull(),
  instantSavings: doublePrecision('instant_savings').notNull(),
  couponCode: text('coupon_code'),
  couponDiscount: doublePrecision('coupon_discount').notNull().default(0),
  promotionId: text('promotion_id'),
  promotionTitle: text('promotion_title'),
  shippingFee: doublePrecision('shipping_fee').notNull().default(0),
  shippingSpeed: text('shipping_speed').notNull().default('standard'),
  codFee: doublePrecision('cod_fee').notNull().default(0),
  taxableValue: doublePrecision('taxable_value').notNull(),
  gstAmount: doublePrecision('gst_amount').notNull(),
  totalAmount: doublePrecision('total_amount').notNull(),
  gatewayFeeAmount: doublePrecision('gateway_fee_amount'),
  actualShippingCost: doublePrecision('actual_shipping_cost'),
  paymentMethod: text('payment_method').notNull(),
  paymentStatus: text('payment_status').notNull(),
  razorpayOrderId: text('razorpay_order_id'),
  razorpayPaymentId: text('razorpay_payment_id'),
  paymentVerifiedAt: text('payment_verified_at'),
  status: text('status').notNull(),
  trackingNumber: text('tracking_number'),
  courierName: text('courier_name'),
  trackingUrl: text('tracking_url'),
  estimatedDelivery: text('estimated_delivery'),
  dispatchedAt: text('dispatched_at'),
  deliveredAt: text('delivered_at'),
  refundAmount: doublePrecision('refund_amount'),
  refundReason: text('refund_reason'),
  refundRequestedAt: text('refund_requested_at'),
  timeline: jsonb('timeline').$type<OrderTimelineEvent[]>().notNull().default([]),
  createdAt: text('created_at').notNull(),
});

export const coupons = pgTable('coupons', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  code: text('code').notNull().unique(),
  type: text('type').notNull(),
  value: doublePrecision('value').notNull(),
  minOrderValue: doublePrecision('min_order_value').notNull().default(0),
  maxDiscount: doublePrecision('max_discount'),
  active: boolean('active').notNull().default(true),
  description: text('description').notNull(),
});

export const promotions = pgTable('promotions', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  title: text('title').notNull(),
  description: text('description').notNull(),
  bannerHeadline: text('banner_headline').notNull(),
  bannerSubtext: text('banner_subtext').notNull(),
  bannerTheme: text('banner_theme').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  freeShipping: boolean('free_shipping').notNull().default(false),
  freeShippingSpeed: text('free_shipping_speed').notNull().default('standard'),
  discountPercent: doublePrecision('discount_percent').notNull().default(0),
  promoCode: text('promo_code'),
  enabled: boolean('enabled').notNull().default(true),
  usageCount: integer('usage_count').notNull().default(0),
  revenueGenerated: doublePrecision('revenue_generated').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const labReports = pgTable('lab_reports', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  batchNumber: text('batch_number').notNull().default(''),
  testedBatchNumber: text('tested_batch_number').notNull(),
  reportNumber: text('report_number').notNull(),
  laboratoryName: text('laboratory_name').notNull(),
  accreditation: text('accreditation').notNull().default(''),
  testDate: text('test_date').notNull(),
  expiryDate: text('expiry_date').notNull().default(''),
  sampleDescription: text('sample_description').notNull().default(''),
  fulvicAcidPercent: text('fulvic_acid_percent').notNull().default(''),
  heavyMetals: jsonb('heavy_metals').$type<LabHeavyMetalResult[]>().notNull().default([]),
  microbiological: jsonb('microbiological').$type<LabMicrobiologicalResult[]>().notNull().default([]),
  verdict: text('verdict').notNull().default('Reference Sample'),
  summaryNote: text('summary_note').notNull().default(''),
  mappedProductIds: jsonb('mapped_product_ids').$type<string[]>().notNull().default([]),
  testingMethodology: text('testing_methodology').notNull().default(''),
  verifiedStatus: text('verified_status').notNull().default('Reference Sample'),
  notes: text('notes').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(''),
  customDocumentUrl: text('custom_document_url'),
  originalFileName: text('original_file_name'),
  originalMimeType: text('original_mime_type'),
});

export const cmsSections = pgTable('cms_sections', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  key: text('key').notNull(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  content: text('content').notNull(),
  approvedByAdmin: boolean('approved_by_admin').notNull().default(false),
  approvedAt: text('approved_at'),
  updatedAt: text('updated_at').notNull(),
});

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  date: text('date').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  amount: doublePrecision('amount').notNull(),
});

export const inquiries = pgTable('inquiries', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull().default(''),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('New'),
  replyMessage: text('reply_message'),
  repliedAt: text('replied_at'),
  repliedVia: jsonb('replied_via').$type<InquiryReplyChannel[] | null>(),
  emailDeliveryStatus: text('email_delivery_status'),
  createdAt: text('created_at').notNull(),
});

export const adminNotifications = pgTable('admin_notifications', {
  id: text('id').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  orderId: text('order_id'),
  orderNumber: text('order_number'),
  customerName: text('customer_name'),
  amount: doublePrecision('amount'),
  read: boolean('read').notNull().default(false),
  emailNotifiedTo: text('email_notified_to'),
  createdAt: text('created_at').notNull(),
});

export const paymentIntents = pgTable('payment_intents', {
  razorpayOrderId: text('razorpay_order_id').primaryKey(),
  amountPaise: integer('amount_paise').notNull(),
  verified: boolean('verified').notNull().default(false),
  paymentId: text('payment_id'),
  signatureVerified: boolean('signature_verified').notNull().default(false),
  method: text('method').notNull(),
  createdAt: text('created_at').notNull(),
});

export const storeSettings = pgTable('store_settings', {
  id: text('id').primaryKey(),
  payload: jsonb('payload').$type<StoreSettings>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Drizzle Relations
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  customer: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
}));
