import type {
  CartItem,
  Coupon,
  Expense,
  Order,
  OrderStatus,
  PaymentMethod,
  Product,
  Promotion,
  ShippingAddress,
  StoreSettings,
} from '../types';

export const FREE_SHIPPING_PROMO_END_ISO = '2026-11-30T23:59:59+05:30';
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function toIstDateString(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatPaymentMethodLabel(method?: string | null): string {
  const normalized = String(method ?? '')
    .trim()
    .toLowerCase();
  switch (normalized) {
    case 'netbanking':
    case 'net_banking':
    case 'bank_transfer':
      return 'Netbanking';
    case 'upi':
      return 'UPI';
    case 'card':
      return 'Card';
    case 'wallet':
      return 'Wallet';
    case 'emi':
    case 'cardless_emi':
      return 'EMI';
    case 'paylater':
    case 'pay_later':
      return 'Pay Later';
    case 'cod':
      return 'COD';
    case 'online':
      return 'Online';
    default:
      return method?.trim() || 'Online';
  }
}

export function isPromotionActive(promo: Promotion, nowMs: number = Date.now()): boolean {
  if (!promo.enabled) return false;
  const start = Date.parse(promo.startsAt);
  const end = Date.parse(promo.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return nowMs >= start && nowMs <= end;
}

export function getActivePromotions(
  promotions: Promotion[] = [],
  nowMs: number = Date.now()
): Promotion[] {
  return promotions.filter((p) => isPromotionActive(p, nowMs));
}

export function getActiveFreeShippingPromotion(
  promotions: Promotion[] = [],
  nowMs: number = Date.now()
): Promotion | undefined {
  return promotions.find(
    (p) => isPromotionActive(p, nowMs) && p.freeShipping && !p.promoCode?.trim()
  );
}

export function getCountdownParts(targetIso: string, nowMs: number = Date.now()) {
  const targetMs = Date.parse(targetIso);
  if (Number.isNaN(targetMs) || targetMs <= nowMs) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const diffSec = Math.floor((targetMs - nowMs) / 1000);
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;
  return { expired: false, days, hours, minutes, seconds };
}

export interface ParsedChargeInput {
  valid: boolean;
  value: number;
  isFreeNA: boolean;
}

export function parseShippingOrCodInput(raw: string): ParsedChargeInput {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, value: 0, isFreeNA: true };
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === 'n/a' || lowered === 'na' || lowered === 'free' || lowered === 'none') {
    return { valid: true, value: 0, isFreeNA: true };
  }
  const cleaned = trimmed.replace(/[₹,\s]/g, '');
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) {
    return { valid: false, value: 0, isFreeNA: false };
  }
  const rounded = Math.round(num);
  return { valid: true, value: rounded, isFreeNA: rounded === 0 };
}

export function formatChargeForEditor(amount: number): string {
  return !Number.isFinite(amount) || amount <= 0 ? 'N/A' : String(Math.round(amount));
}

export interface CartCalculation {
  itemCount: number;
  mrpTotal: number;
  subtotal: number;
  instantSavings: number;
  discountPercent: number;
  couponDiscount: number;
  shippingFee: number;
  codFee: number;
  taxableValue: number;
  gstAmount: number;
  grandTotal: number;
  freeShippingRemaining: number;
  appliedCoupon?: Coupon;
  appliedPromotion?: Promotion;
  freeShippingByPromo: boolean;
  freeShippingByNA: boolean;
}

export function calculateCartTotals(
  cartItems: CartItem[],
  products: Product[],
  settings: StoreSettings,
  options?: {
    shippingSpeed?: 'standard' | 'express';
    paymentMethod?: PaymentMethod;
    couponCode?: string;
    coupons?: Coupon[];
    promotions?: Promotion[];
    nowMs?: number;
  }
): CartCalculation {
  const shippingSpeed = options?.shippingSpeed ?? 'standard';
  const paymentMethod = options?.paymentMethod ?? 'UPI';
  const coupons = options?.coupons ?? [];
  const promotions = options?.promotions ?? [];
  const nowMs = options?.nowMs ?? Date.now();
  const code = (options?.couponCode ?? '').trim().toUpperCase();

  let itemCount = 0;
  let mrpTotal = 0;
  let subtotal = 0;
  let gstRateWeighted = 12;

  for (const item of cartItems) {
    if (item.quantity <= 0) continue;
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;
    itemCount += item.quantity;
    mrpTotal += product.mrp * item.quantity;
    subtotal += product.price * item.quantity;
    gstRateWeighted = product.gstRatePercent;
  }

  const instantSavings = Math.max(0, mrpTotal - subtotal);
  const discountPercent = mrpTotal > 0 ? Math.round((instantSavings / mrpTotal) * 100) : 0;

  let couponDiscount = 0;
  let appliedCoupon: Coupon | undefined;
  let appliedPromotion: Promotion | undefined;

  const activePromos = getActivePromotions(promotions, nowMs);
  const automaticFreeShipPromo = activePromos.find(
    (p) => p.freeShipping && (!p.promoCode || !p.promoCode.trim())
  );
  const automaticDiscountPromo = activePromos.find(
    (p) => p.discountPercent > 0 && (!p.promoCode || !p.promoCode.trim())
  );
  const codeMatchedPromo = code
    ? activePromos.find((p) => p.promoCode && p.promoCode.trim().toUpperCase() === code)
    : undefined;

  if (codeMatchedPromo && subtotal > 0) {
    appliedPromotion = codeMatchedPromo;
    if (codeMatchedPromo.discountPercent > 0) {
      couponDiscount = Math.round((subtotal * codeMatchedPromo.discountPercent) / 100);
      appliedCoupon = {
        code: codeMatchedPromo.promoCode!.toUpperCase(),
        discountType: 'percent',
        value: codeMatchedPromo.discountPercent,
        minOrderAmount: 0,
        active: true,
        description: codeMatchedPromo.title,
      };
    }
  } else if (code && subtotal > 0) {
    const found = coupons.find((c) => c.active && c.code.toUpperCase() === code);
    if (found && subtotal >= found.minOrderAmount) {
      appliedCoupon = found;
      couponDiscount =
        found.discountType === 'percent'
          ? Math.round((subtotal * found.value) / 100)
          : Math.min(found.value, subtotal);
    }
  } else if (automaticDiscountPromo && subtotal > 0) {
    appliedPromotion = automaticDiscountPromo;
    couponDiscount = Math.round((subtotal * automaticDiscountPromo.discountPercent) / 100);
  }

  if (!appliedPromotion && automaticFreeShipPromo) {
    appliedPromotion = automaticFreeShipPromo;
  }

  const discountedSubtotal = Math.max(0, subtotal - couponDiscount);

  const promoGrantsFreeShipping = Boolean(
    appliedPromotion?.freeShipping &&
      (appliedPromotion.freeShippingSpeed === 'all' || shippingSpeed === 'standard')
  );

  const hasFreeThreshold = settings.freeShippingThreshold > 0;
  const standardFee = Math.max(0, Number(settings.standardShippingFee) || 0);
  const freeShippingByNA = standardFee === 0;
  let shippingFee = 0;
  let freeShippingByPromo = false;
  if (itemCount > 0) {
    if (shippingSpeed === 'express') {
      shippingFee = promoGrantsFreeShipping ? 0 : Math.max(0, Number(settings.expressShippingFee) || 0);
      freeShippingByPromo = promoGrantsFreeShipping;
    } else if (freeShippingByNA) {
      shippingFee = 0;
      freeShippingByPromo = false;
    } else if (promoGrantsFreeShipping) {
      shippingFee = 0;
      freeShippingByPromo = true;
    } else {
      shippingFee =
        hasFreeThreshold && discountedSubtotal >= settings.freeShippingThreshold
          ? 0
          : standardFee;
    }
  }

  const freeShippingRemaining =
    itemCount > 0 &&
    !freeShippingByNA &&
    !promoGrantsFreeShipping &&
    hasFreeThreshold &&
    discountedSubtotal < settings.freeShippingThreshold
      ? settings.freeShippingThreshold - discountedSubtotal
      : 0;

  const configuredCodFee = Math.max(0, Number(settings.codFee) || 0);
  const codFee = itemCount > 0 && paymentMethod === 'COD' ? configuredCodFee : 0;

  const grandTotal = discountedSubtotal + shippingFee + codFee;

  // Compute inclusive GST breakdown on discounted product subtotal
  const gstMultiplier = 1 + gstRateWeighted / 100;
  const taxableValue =
    discountedSubtotal > 0 ? Math.round((discountedSubtotal / gstMultiplier) * 100) / 100 : 0;
  const gstAmount = Math.round((discountedSubtotal - taxableValue) * 100) / 100;

  return {
    itemCount,
    mrpTotal,
    subtotal,
    instantSavings,
    discountPercent,
    couponDiscount,
    shippingFee,
    codFee,
    taxableValue,
    gstAmount,
    grandTotal,
    freeShippingRemaining,
    appliedCoupon,
    appliedPromotion,
    freeShippingByPromo,
    freeShippingByNA,
  };
}

export interface CheckoutValidationErrors {
  fullName?: string;
  phone?: string;
  email?: string;
  line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export function validateCheckoutForm(address: ShippingAddress): {
  valid: boolean;
  errors: CheckoutValidationErrors;
} {
  const errors: CheckoutValidationErrors = {};
  const cleanPhone = address.phone.replace(/\D/g, '');
  const cleanPin = address.pincode.trim();

  if (!address.fullName || address.fullName.trim().length < 2) {
    errors.fullName = 'Please enter recipient full name.';
  }
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
    errors.phone = 'Enter a valid 10-digit Indian mobile number.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email.trim())) {
    errors.email = 'Enter a valid email address for order updates.';
  }
  if (!address.line1 || address.line1.trim().length < 4) {
    errors.line1 = 'Enter complete street / locality address.';
  }
  if (!address.city || address.city.trim().length < 2) {
    errors.city = 'Enter city or town.';
  }
  if (!address.state || address.state.trim().length < 2) {
    errors.state = 'Select or enter state.';
  }
  if (!/^[1-9][0-9]{5}$/.test(cleanPin)) {
    errors.pincode = 'Enter a valid 6-digit Indian PIN code.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export const ORDER_STAGES: OrderStatus[] = [
  'Pending Payment',
  'Payment Confirmed',
  'Processing',
  'Packed',
  'Dispatched',
  'Out for Delivery',
  'Delivered',
];

export const ALL_ORDER_STATUSES: OrderStatus[] = [
  ...ORDER_STAGES,
  'Cancelled',
  'Refunded',
];

export function normalizeLegacyOrderStatus(raw: string): OrderStatus {
  switch (raw) {
    case 'Placed':
      return 'Pending Payment';
    case 'Confirmed':
      return 'Payment Confirmed';
    case 'Quality Checked':
      return 'Packed';
    case 'Shipped':
      return 'Dispatched';
    case 'Pending Payment':
    case 'Payment Confirmed':
    case 'Processing':
    case 'Packed':
    case 'Dispatched':
    case 'Out for Delivery':
    case 'Delivered':
    case 'Cancelled':
    case 'Refunded':
      return raw;
    default:
      return 'Processing';
  }
}

export function getOrderStageIndex(status: OrderStatus): number {
  if (status === 'Cancelled' || status === 'Refunded') return -1;
  return ORDER_STAGES.indexOf(status);
}

export interface ProfitSummary {
  totalOrders: number;
  totalPaidOrders: number;
  grossRevenue: number;
  totalSalesToday: number;
  monthlyRevenue: number;
  annualRevenue: number;
  totalCogs: number;
  totalShippingCollected: number;
  shippingExpenses: number;
  gatewayFees: number;
  refundsTotal: number;
  operatingExpenses: number;
  netProfit: number;
  profitMarginPercent: number;
  averageOrderValue: number;
  dailySales: Array<{
    date: string;
    label: string;
    revenue: number;
    orders: number;
  }>;
  weeklyOrders: Array<{
    week: string;
    orders: number;
    revenue: number;
  }>;
  monthlySeries: Array<{
    month: string;
    revenue: number;
    expenses: number;
    profit: number;
    orders: number;
  }>;
  annualSales: Array<{
    year: string;
    revenue: number;
    profit: number;
    orders: number;
  }>;
  statusDistribution: Array<{
    status: string;
    count: number;
  }>;
  expenseByCategory: Array<{
    category: string;
    amount: number;
  }>;
}

export function calculateProfitMetrics(
  orders: Order[],
  expenses: Expense[],
  options?: {
    gatewayFeePercent?: number;
    defaultShippingCostPerOrder?: number;
    nowMs?: number;
  }
): ProfitSummary {
  const gatewayFeePercent = options?.gatewayFeePercent ?? 2;
  const defaultShippingCost = options?.defaultShippingCostPerOrder ?? 65;
  const nowMs = options?.nowMs ?? Date.now();
  const todayIst = toIstDateString(nowMs);
  const currentMonthIst = todayIst.slice(0, 7);
  const currentYearIst = todayIst.slice(0, 4);

  const activeOrders = orders.filter(
    (o) => o.status !== 'Cancelled' && o.status !== 'Refunded'
  );
  const refundedOrders = orders.filter(
    (o) => o.status === 'Refunded' || o.paymentStatus === 'Refunded'
  );
  const totalOrders = activeOrders.length;
  const totalPaidOrders = activeOrders.filter((o) => o.paymentStatus === 'Paid').length;

  let grossRevenue = 0;
  let totalSalesToday = 0;
  let monthlyRevenue = 0;
  let annualRevenue = 0;
  let totalCogs = 0;
  let totalShippingCollected = 0;
  let orderShippingExpenses = 0;
  let gatewayFees = 0;
  let refundsTotal = 0;

  for (const rOrd of refundedOrders) {
    refundsTotal += rOrd.refundAmount ?? rOrd.totalAmount;
  }

  const dailyMap = new Map<string, { date: string; revenue: number; orders: number }>();
  const weeklyMap = new Map<string, { week: string; orders: number; revenue: number }>();
  const monthlyMap = new Map<
    string,
    { month: string; revenue: number; cogs: number; shipExp: number; gwFees: number; opEx: number; orders: number }
  >();
  const annualMap = new Map<
    string,
    { year: string; revenue: number; expenses: number; orders: number }
  >();
  const statusMap = new Map<string, number>();

  for (const ord of orders) {
    statusMap.set(ord.status, (statusMap.get(ord.status) ?? 0) + 1);
  }

  for (const order of activeOrders) {
    const orderIstDate = toIstDateString(order.createdAt);
    const monthKey = orderIstDate.slice(0, 7) || order.createdAt.slice(0, 7);
    const yearKey = orderIstDate.slice(0, 4) || order.createdAt.slice(0, 4);

    grossRevenue += order.totalAmount;
    if (orderIstDate === todayIst) totalSalesToday += order.totalAmount;
    if (monthKey === currentMonthIst) monthlyRevenue += order.totalAmount;
    if (yearKey === currentYearIst) annualRevenue += order.totalAmount;

    totalShippingCollected += order.shippingFee;
    const orderCogs = order.items.reduce((sum, item) => sum + item.unitCost * item.quantity, 0);
    totalCogs += orderCogs;

    const shipCost =
      typeof order.actualShippingCost === 'number'
        ? order.actualShippingCost
        : defaultShippingCost;
    orderShippingExpenses += shipCost;

    const gwFee =
      typeof order.gatewayFeeAmount === 'number'
        ? order.gatewayFeeAmount
        : order.paymentMethod !== 'COD' && order.paymentStatus === 'Paid'
        ? Math.round(order.totalAmount * (gatewayFeePercent / 100) * 100) / 100
        : 0;
    gatewayFees += gwFee;

    // Daily bucket
    const dEntry = dailyMap.get(orderIstDate) ?? {
      date: orderIstDate,
      revenue: 0,
      orders: 0,
    };
    dEntry.revenue += order.totalAmount;
    dEntry.orders += 1;
    dailyMap.set(orderIstDate, dEntry);

    // Weekly bucket (Monday start in IST)
    const dObj = new Date(`${orderIstDate}T00:00:00Z`);
    const dayOfWeek = dObj.getUTCDay();
    const diffToMon = (dayOfWeek + 6) % 7;
    const monday = new Date(dObj.getTime() - diffToMon * 86400000);
    const weekKey = monday.toISOString().slice(0, 10);
    const wEntry = weeklyMap.get(weekKey) ?? { week: weekKey, orders: 0, revenue: 0 };
    wEntry.orders += 1;
    wEntry.revenue += order.totalAmount;
    weeklyMap.set(weekKey, wEntry);

    // Monthly bucket
    const existing = monthlyMap.get(monthKey) ?? {
      month: monthKey,
      revenue: 0,
      cogs: 0,
      shipExp: 0,
      gwFees: 0,
      opEx: 0,
      orders: 0,
    };
    existing.revenue += order.totalAmount;
    existing.cogs += orderCogs;
    existing.shipExp += shipCost;
    existing.gwFees += gwFee;
    existing.orders += 1;
    monthlyMap.set(monthKey, existing);

    // Annual bucket
    const yEntry = annualMap.get(yearKey) ?? {
      year: yearKey,
      revenue: 0,
      expenses: 0,
      orders: 0,
    };
    yEntry.revenue += order.totalAmount;
    yEntry.expenses += orderCogs + shipCost + gwFee;
    yEntry.orders += 1;
    annualMap.set(yearKey, yEntry);
  }

  let operatingExpenses = 0;
  let loggedShippingExpense = 0;
  const catMap = new Map<string, number>();

  for (const exp of expenses) {
    operatingExpenses += exp.amount;
    if (exp.category === 'Shipping') {
      loggedShippingExpense += exp.amount;
    }
    catMap.set(exp.category, (catMap.get(exp.category) ?? 0) + exp.amount);

    const monthKey = exp.date.slice(0, 7);
    const existing = monthlyMap.get(monthKey) ?? {
      month: monthKey,
      revenue: 0,
      cogs: 0,
      shipExp: 0,
      gwFees: 0,
      opEx: 0,
      orders: 0,
    };
    existing.opEx += exp.amount;
    monthlyMap.set(monthKey, existing);

    const yearKey = exp.date.slice(0, 4);
    const yEntry = annualMap.get(yearKey) ?? {
      year: yearKey,
      revenue: 0,
      expenses: 0,
      orders: 0,
    };
    yEntry.expenses += exp.amount;
    annualMap.set(yearKey, yEntry);
  }

  const shippingExpenses = Math.round((orderShippingExpenses + loggedShippingExpense) * 100) / 100;
  const nonShippingOpEx = operatingExpenses - loggedShippingExpense;
  const roundedGatewayFees = Math.round(gatewayFees * 100) / 100;
  const netProfit =
    Math.round(
      (grossRevenue -
        totalCogs -
        shippingExpenses -
        roundedGatewayFees -
        nonShippingOpEx -
        refundsTotal) *
        100
    ) / 100;
  const profitMarginPercent =
    grossRevenue > 0 ? Math.round((netProfit / grossRevenue) * 1000) / 10 : 0;
  const averageOrderValue = totalOrders > 0 ? Math.round(grossRevenue / totalOrders) : 0;

  const dailySales = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
    .map((d) => ({
      ...d,
      label: d.date.slice(5),
    }));

  const weeklyOrders = Array.from(weeklyMap.values())
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-8);

  const monthlySeries = Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((entry) => {
      const totalExp =
        Math.round((entry.cogs + entry.shipExp + entry.gwFees + entry.opEx) * 100) / 100;
      return {
        month: entry.month,
        revenue: Math.round(entry.revenue * 100) / 100,
        expenses: totalExp,
        profit: Math.round((entry.revenue - totalExp) * 100) / 100,
        orders: entry.orders,
      };
    });

  const annualSales = Array.from(annualMap.values())
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((y) => ({
      year: y.year,
      revenue: Math.round(y.revenue * 100) / 100,
      profit: Math.round((y.revenue - y.expenses) * 100) / 100,
      orders: y.orders,
    }));

  const statusDistribution = Array.from(statusMap.entries()).map(([status, count]) => ({
    status,
    count,
  }));

  const expenseByCategory = Array.from(catMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    totalOrders,
    totalPaidOrders,
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    totalSalesToday: Math.round(totalSalesToday * 100) / 100,
    monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    annualRevenue: Math.round(annualRevenue * 100) / 100,
    totalCogs: Math.round(totalCogs * 100) / 100,
    totalShippingCollected,
    shippingExpenses,
    gatewayFees: roundedGatewayFees,
    refundsTotal: Math.round(refundsTotal * 100) / 100,
    operatingExpenses,
    netProfit,
    profitMarginPercent,
    averageOrderValue,
    dailySales,
    weeklyOrders,
    monthlySeries,
    annualSales,
    statusDistribution,
    expenseByCategory,
  };
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function isAuthorizedAdmin(
  user: { email?: string; role?: string } | null | undefined,
  ownerEmail: string
): boolean {
  if (!user || !ownerEmail) return false;
  return (
    user.role === 'admin' &&
    typeof user.email === 'string' &&
    user.email.trim().toLowerCase() === ownerEmail.trim().toLowerCase()
  );
}

export function normalizeInquiryPhone(rawPhone?: string): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return null;
}

export interface InquiryReplyLinks {
  recipientEmail: string;
  recipientPhone: string | null;
  subject: string;
  formattedBody: string;
  mailtoUrl: string;
  whatsappUrl: string | null;
  smsUrl: string | null;
}

export function buildInquiryReplyLinks(
  inquiry: {
    name: string;
    email: string;
    phone?: string;
    subject: string;
    message: string;
  },
  replyMessage: string,
  brandName = 'HimRudra Support'
): InquiryReplyLinks {
  const recipientEmail = inquiry.email.trim();
  const recipientPhone = normalizeInquiryPhone(inquiry.phone);
  const cleanReply = replyMessage.trim();
  const cleanSubject = inquiry.subject?.trim() || 'Your Inquiry';
  const subject = `Re: ${cleanSubject} — ${brandName}`;

  const formattedBody = [
    `Hello ${inquiry.name.trim() || 'Customer'},`,
    '',
    cleanReply,
    '',
    '---',
    `Your original query (${cleanSubject}):`,
    inquiry.message.trim(),
    '',
    `Warm regards,`,
    brandName,
  ].join('\n');

  const mailtoUrl = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(formattedBody)}`;

  const whatsappText = [
    `Hello ${inquiry.name.trim() || 'Customer'}, regarding your HimRudra inquiry (${cleanSubject}):`,
    '',
    cleanReply,
    '',
    `— ${brandName}`,
  ].join('\n');

  const whatsappUrl = recipientPhone
    ? `https://wa.me/${recipientPhone}?text=${encodeURIComponent(whatsappText)}`
    : null;

  const smsUrl = recipientPhone
    ? `sms:+${recipientPhone}?body=${encodeURIComponent(whatsappText)}`
    : null;

  return {
    recipientEmail,
    recipientPhone,
    subject,
    formattedBody,
    mailtoUrl,
    whatsappUrl,
    smsUrl,
  };
}

