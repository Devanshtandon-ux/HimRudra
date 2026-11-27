import type {
  CheckoutActivityStatus,
  LiveCheckoutActivityItem,
  LiveCheckoutActivityProductLine,
  LiveCheckoutActivityResponse,
  LiveCheckoutActivitySummary,
  Order,
  Product,
  ShippingAddress,
} from '../src/types.ts';
import type { PaymentIntentRecord } from './store.ts';

export const CHECKOUT_ACTIVITY_STATUS_LABELS: Record<CheckoutActivityStatus, string> = {
  initiated: 'Initiated',
  pending: 'Pending',
  failed: 'Failed',
  captured: 'Captured (No Order Yet)',
  confirmed: 'Confirmed Order',
};

export function formatShippingAddressReadable(address?: ShippingAddress | null): string | undefined {
  if (!address) return undefined;
  const streetParts = [
    address.houseFlatNumber?.trim(),
    address.line1?.trim(),
    address.line2?.trim(),
    address.landmark?.trim() ? `Near ${address.landmark.trim()}` : undefined,
  ].filter((part): part is string => Boolean(part));

  const cityState = [address.city?.trim(), address.state?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  const locality =
    cityState && address.pincode?.trim()
      ? `${cityState} - ${address.pincode.trim()}`
      : cityState || address.pincode?.trim() || '';

  const full = [...streetParts, locality].filter(Boolean).join(', ');
  return full || undefined;
}

export function classifyCheckoutActivityStatus(
  intent: PaymentIntentRecord,
  matchedOrder: Order | null
): { status: CheckoutActivityStatus; statusLabel: string } {
  if (matchedOrder) {
    if (matchedOrder.paymentStatus === 'Failed') {
      return {
        status: 'failed',
        statusLabel: CHECKOUT_ACTIVITY_STATUS_LABELS.failed,
      };
    }
    if (matchedOrder.paymentStatus === 'Pending Payment') {
      return {
        status: 'pending',
        statusLabel: CHECKOUT_ACTIVITY_STATUS_LABELS.pending,
      };
    }
    return {
      status: 'confirmed',
      statusLabel: CHECKOUT_ACTIVITY_STATUS_LABELS.confirmed,
    };
  }

  const gatewayStatus = intent.checkoutPayload?.gatewayStatus;
  const hasFailure = Boolean(intent.checkoutPayload?.paymentFailure);
  const hasPendingPayment = Boolean(intent.checkoutPayload?.pendingPaymentId);

  if (
    intent.verified ||
    intent.signatureVerified ||
    gatewayStatus === 'captured' ||
    (Boolean(intent.paymentId) && gatewayStatus !== 'failed' && gatewayStatus !== 'pending')
  ) {
    return {
      status: 'captured',
      statusLabel: CHECKOUT_ACTIVITY_STATUS_LABELS.captured,
    };
  }

  if (gatewayStatus === 'failed' || hasFailure) {
    return {
      status: 'failed',
      statusLabel: CHECKOUT_ACTIVITY_STATUS_LABELS.failed,
    };
  }

  if (gatewayStatus === 'pending' || hasPendingPayment) {
    return {
      status: 'pending',
      statusLabel: CHECKOUT_ACTIVITY_STATUS_LABELS.pending,
    };
  }

  return {
    status: 'initiated',
    statusLabel: CHECKOUT_ACTIVITY_STATUS_LABELS.initiated,
  };
}

function resolveProductLines(
  intent: PaymentIntentRecord,
  matchedOrder: Order | null,
  productById: Map<string, Product>
): LiveCheckoutActivityProductLine[] {
  const draftItems = intent.checkoutPayload?.items;
  if (Array.isArray(draftItems) && draftItems.length > 0) {
    return draftItems.map((item) => {
      const product = productById.get(item.productId);
      const matchedOrderItem = matchedOrder?.items.find((oi) => oi.productId === item.productId);
      return {
        productId: item.productId,
        name: product?.name || matchedOrderItem?.name || item.productId,
        sku: product?.sku || matchedOrderItem?.sku,
        netQuantity: product?.netQuantity || matchedOrderItem?.netQuantity,
        quantity: Number(item.quantity) || 0,
        unitPrice: matchedOrderItem?.unitPrice ?? product?.price,
      };
    });
  }

  if (matchedOrder && Array.isArray(matchedOrder.items) && matchedOrder.items.length > 0) {
    return matchedOrder.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      netQuantity: item.netQuantity,
      quantity: Number(item.quantity) || 0,
      unitPrice: item.unitPrice,
    }));
  }

  return [];
}

function detectTestCheckoutCandidateReason(params: {
  razorpayOrderId: string;
  customerName?: string;
  customerEmail?: string;
  ownerEmail?: string;
}): string | undefined {
  const reasons: string[] = [];
  const lowerEmail = params.customerEmail?.trim().toLowerCase() || '';
  const lowerName = params.customerName?.trim().toLowerCase() || '';
  const normalizedOwner = params.ownerEmail?.trim().toLowerCase() || '';

  if (normalizedOwner && lowerEmail && lowerEmail === normalizedOwner) {
    reasons.push('Store owner email');
  }
  if (lowerEmail.includes('test') || lowerEmail.endsWith('@example.com')) {
    reasons.push('Test/example email');
  }
  if (lowerName.includes('test')) {
    reasons.push('Test customer name');
  }
  if (params.razorpayOrderId.toLowerCase().startsWith('order_test')) {
    reasons.push('Test Razorpay order ID');
  }
  return reasons.length > 0 ? reasons.join(' · ') : undefined;
}

export function buildLiveCheckoutActivity(params: {
  intents: PaymentIntentRecord[];
  orders: Order[];
  products: Product[];
  ownerEmail?: string;
  refreshedAt?: string;
}): LiveCheckoutActivityResponse {
  const { intents, orders, products, ownerEmail } = params;
  const refreshedAt = params.refreshedAt ?? new Date().toISOString();

  const orderById = new Map<string, Order>();
  const orderByRzpOrderId = new Map<string, Order>();
  const orderByRzpPaymentId = new Map<string, Order>();
  for (const order of orders) {
    orderById.set(order.id, order);
    if (order.razorpayOrderId) {
      orderByRzpOrderId.set(order.razorpayOrderId, order);
    }
    if (order.razorpayPaymentId) {
      orderByRzpPaymentId.set(order.razorpayPaymentId, order);
    }
  }

  const productById = new Map<string, Product>();
  for (const product of products) {
    productById.set(product.id, product);
  }

  const counts: LiveCheckoutActivitySummary = {
    total: 0,
    initiated: 0,
    pending: 0,
    failed: 0,
    captured: 0,
    confirmed: 0,
  };

  const items: LiveCheckoutActivityItem[] = intents.map((intent) => {
    const matchedOrder =
      (intent.orderId ? orderById.get(intent.orderId) : undefined) ??
      orderByRzpOrderId.get(intent.razorpayOrderId) ??
      (intent.paymentId ? orderByRzpPaymentId.get(intent.paymentId) : undefined) ??
      null;

    const { status, statusLabel } = classifyCheckoutActivityStatus(intent, matchedOrder);
    counts.total += 1;
    counts[status] += 1;

    const payload = intent.checkoutPayload;
    const shippingAddress = payload?.shippingAddress ?? matchedOrder?.shippingAddress;
    const resolvedItems = resolveProductLines(intent, matchedOrder, productById);
    const totalQuantity = resolvedItems.reduce((sum, line) => sum + line.quantity, 0);

    const amountPaise =
      typeof intent.amountPaise === 'number' && Number.isFinite(intent.amountPaise)
        ? Math.round(intent.amountPaise)
        : matchedOrder
        ? Math.round(matchedOrder.totalAmount * 100)
        : 0;
    const amountInr = Math.round(amountPaise) / 100;

    const customerName = shippingAddress?.fullName?.trim() || matchedOrder?.customerName;
    const customerEmail = shippingAddress?.email?.trim() || matchedOrder?.customerEmail;
    const customerPhone = shippingAddress?.phone?.trim() || matchedOrder?.customerPhone;

    // Strictly allow cleanup selection ONLY for unpaid attempts (never captured payments like pay_U4m5a9iAVX2oU4 or confirmed orders)
    const canSelectForTestCleanup =
      (status === 'initiated' || status === 'pending' || status === 'failed') &&
      !intent.verified &&
      !intent.signatureVerified &&
      !intent.paymentId &&
      !matchedOrder;

    const testCandidateReason = canSelectForTestCleanup
      ? detectTestCheckoutCandidateReason({
          razorpayOrderId: intent.razorpayOrderId,
          customerName,
          customerEmail,
          ownerEmail,
        })
      : undefined;

    return {
      razorpayOrderId: intent.razorpayOrderId,
      razorpayPaymentId: intent.paymentId ?? matchedOrder?.razorpayPaymentId,
      pendingPaymentId: payload?.pendingPaymentId,
      failedPaymentId: payload?.paymentFailure?.paymentId,
      status,
      statusLabel,
      paymentMethod: intent.method || payload?.paymentMethod || matchedOrder?.paymentMethod || 'Online',
      amountPaise,
      amountInr,
      verified: Boolean(intent.verified),
      signatureVerified: Boolean(intent.signatureVerified),
      hasCheckoutPayload: Boolean(payload),
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress,
      formattedAddress: formatShippingAddressReadable(shippingAddress),
      pincode: shippingAddress?.pincode?.trim() || undefined,
      deliveryInstructions: payload?.deliveryInstructions ?? matchedOrder?.deliveryInstructions,
      shippingSpeed: payload?.shippingSpeed ?? matchedOrder?.shippingSpeed,
      couponCode: payload?.couponCode ?? matchedOrder?.couponCode,
      items: resolvedItems,
      totalQuantity,
      linkedOrderId: matchedOrder?.id ?? intent.orderId,
      linkedOrderNumber: matchedOrder?.orderNumber,
      linkedOrderStatus: matchedOrder?.status,
      linkedOrderPaymentStatus: matchedOrder?.paymentStatus,
      failureReason: payload?.paymentFailure?.reason,
      failureCode: payload?.paymentFailure?.code,
      canSelectForTestCleanup,
      testCandidateReason,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
    };
  });

  items.sort((a, b) => {
    const aTime = a.createdAt || a.updatedAt || '';
    const bTime = b.createdAt || b.updatedAt || '';
    return bTime.localeCompare(aTime);
  });

  return {
    items,
    counts,
    refreshedAt,
  };
}
