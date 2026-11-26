export type UserRole = 'customer' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  createdAt: string;
  wishlistProductIds: string[];
  defaultAddress?: ShippingAddress;
}

export interface ShippingAddress {
  fullName: string;
  phone: string;
  email: string;
  houseFlatNumber?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  netQuantity: string;
  sku: string;
  hsnCode: string;
  mrp: number;
  price: number;
  costPerUnit: number;
  stock: number;
  lowStockThreshold: number;
  batchNumber: string;
  gstRatePercent: number;
  shortDescription: string;
  usageGuidance: string;
  storageInstructions: string;
  shippingNote: string;
  returnPolicy: string;
  specifications: Array<{ label: string; value: string }>;
  galleryTypes: Array<'hero' | 'texture' | 'ritual' | 'box'>;
  customImages?: string[];
  active: boolean;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Coupon {
  code: string;
  discountType: 'percent' | 'flat';
  value: number;
  minOrderAmount: number;
  active: boolean;
  description: string;
}

export type BannerTheme = 'crystal-brown-gold' | 'espresso-gold' | 'ivory-brown';

export interface Promotion {
  id: string;
  title: string;
  description: string;
  bannerHeadline: string;
  bannerSubtext: string;
  bannerTheme: BannerTheme;
  startsAt: string;
  endsAt: string;
  freeShipping: boolean;
  freeShippingSpeed: 'standard' | 'all';
  discountPercent: number;
  promoCode?: string;
  enabled: boolean;
  usageCount: number;
  revenueGenerated: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminNotification {
  id: string;
  type: 'new_paid_order' | 'refund_request' | 'system';
  title: string;
  message: string;
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  amount?: number;
  read: boolean;
  emailNotifiedTo?: string;
  createdAt: string;
}

export interface StoreSettings {
  standardShippingFee: number;
  expressShippingFee: number;
  freeShippingThreshold: number;
  codFee: number;
  codEnabled: boolean;
  gstIncludedInPrice: boolean;
  gatewayFeePercent: number;
  defaultShippingCostPerOrder: number;
  orderNotificationEmail: string;
  emailNotificationsEnabled: boolean;
  brandEmail: string;
  brandPhone: string;
  brandAddress: string;
  announcementText: string;
  seoTitle: string;
  seoDescription: string;
}

export type OrderStatus =
  | 'Pending Payment'
  | 'Payment Confirmed'
  | 'Processing'
  | 'Packed'
  | 'Dispatched'
  | 'Out for Delivery'
  | 'Delivered'
  | 'Cancelled'
  | 'Refunded';

export type OrderPaymentStatus =
  | 'Pending Payment'
  | 'Paid'
  | 'Pending COD'
  | 'Failed'
  | 'Refund Requested'
  | 'Refunded';

export type PaymentSettlementStatus =
  | 'Not Applicable'
  | 'Pending Settlement'
  | 'Settled'
  | 'On Hold';

export type PaymentMethod =
  | 'UPI'
  | 'Card'
  | 'NetBanking'
  | 'Wallet'
  | 'EMI'
  | 'PayLater'
  | 'Online'
  | 'COD';

export interface PersistedCheckoutDraft {
  items: CartItem[];
  shippingAddress: ShippingAddress;
  deliveryInstructions?: string;
  shippingSpeed: 'standard' | 'express';
  paymentMethod: PaymentMethod;
  couponCode?: string;
  userId?: string;
}

export interface OrderTimelineEvent {
  status: OrderStatus;
  timestamp: string;
  note: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  sku: string;
  netQuantity: string;
  quantity: number;
  unitPrice: number;
  unitMrp: number;
  unitCost: number;
  batchNumber: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: ShippingAddress;
  deliveryInstructions?: string;
  items: OrderItem[];
  subtotal: number;
  mrpTotal: number;
  instantSavings: number;
  couponCode?: string;
  couponDiscount: number;
  promotionId?: string;
  promotionTitle?: string;
  shippingFee: number;
  shippingSpeed: 'standard' | 'express';
  codFee: number;
  taxableValue: number;
  gstAmount: number;
  totalAmount: number;
  gatewayFeeAmount?: number;
  gatewayTaxAmount?: number;
  gatewayFeeSource?: 'razorpay_actual' | 'estimated';
  actualShippingCost?: number;
  paymentMethod: PaymentMethod;
  paymentStatus: OrderPaymentStatus;
  settlementStatus?: PaymentSettlementStatus;
  razorpaySettlementId?: string;
  settledAt?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paymentVerifiedAt?: string;
  status: OrderStatus;
  courierPartner?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  refundAmount?: number;
  refundReason?: string;
  refundRequestedAt?: string;
  timeline: OrderTimelineEvent[];
  createdAt: string;
}

export interface LabHeavyMetalResult {
  parameter: string;
  method: string;
  specificationLimit: string;
  observedResult: string;
  status: 'Within Limit' | 'Not Detected' | 'Pending Review';
}

export interface LabMicrobiologicalResult {
  parameter: string;
  method: string;
  limit: string;
  observedResult: string;
  status: 'Conforms' | 'Absent' | 'Pending Review';
}

export interface LabReport {
  id: string;
  laboratoryName: string;
  reportNumber: string;
  testedBatchNumber: string;
  testDate: string;
  mappedProductIds: string[];
  testingMethodology: string;
  verifiedStatus: 'Verified' | 'Reference Sample' | 'Pending Verification';
  notes: string;
  customDocumentUrl?: string;
  originalFileName?: string;
  originalMimeType?: string;
  heavyMetals: LabHeavyMetalResult[];
  microbiological: LabMicrobiologicalResult[];
  updatedAt: string;
}

export interface CmsSection {
  id: string;
  key: string;
  title: string;
  category: 'product' | 'faq';
  content: string;
  approvedByAdmin: boolean;
  approvedAt?: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  date: string;
  category: 'Sourcing' | 'Packaging' | 'Lab Testing' | 'Shipping' | 'Marketing' | 'Operations';
  description: string;
  amount: number;
}

export type InquiryReplyChannel = 'Email' | 'WhatsApp' | 'SMS' | 'Direct';

export interface ContactInquiry {
  id: string;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  status: 'New' | 'Responded';
  createdAt: string;
  replyMessage?: string;
  repliedAt?: string;
  repliedVia?: InquiryReplyChannel[];
  emailDeliveryStatus?: 'sent' | 'mailto_ready';
}

export interface PublicStoreBootstrap {
  products: Product[];
  settings: StoreSettings;
  coupons: Coupon[];
  promotions: Promotion[];
  labReports: LabReport[];
  cmsSections: CmsSection[];
  serverNow: string;
}

export interface UnreconciledPaymentIntent {
  razorpayOrderId: string;
  amountPaise: number;
  verified: boolean;
  paymentId?: string;
  signatureVerified: boolean;
  method: string;
  checkoutPayload?: PersistedCheckoutDraft;
  orderId?: string;
  gatewayFeePaise?: number;
  gatewayTaxPaise?: number;
  createdAt: string;
  updatedAt?: string;
}
