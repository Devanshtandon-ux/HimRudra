import type { Order, StoreSettings } from '../src/types.ts';
import { logStructured } from './logger.ts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatInrPlain(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function formatAddressLines(order: Order): string {
  const a = order.shippingAddress;
  const line = [a.houseFlatNumber, a.line1, a.line2, a.landmark].filter(Boolean).join(', ');
  return `${a.fullName}, ${line}, ${a.city}, ${a.state} - ${a.pincode} (Phone: ${a.phone})`;
}

async function sendViaResend(params: {
  apiKey: string;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; error?: string }> {
  const fetchFn = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });
    if (res.ok) {
      return { ok: true };
    }
    const payload = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: payload.message || `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Email provider unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface OrderEmailDispatchResult {
  customerEmailSent: boolean;
  adminEmailSent: boolean;
  skippedReason?: string;
}

/**
 * Dispatches automatic customer order confirmation and admin order alert emails via Resend
 * when RESEND_API_KEY is configured. Strictly non-throwing so checkout never fails on mail outages.
 */
export async function sendAutomaticOrderEmails(params: {
  order: Order;
  settings: StoreSettings;
  requestId?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<OrderEmailDispatchResult> {
  const env = params.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim() || 'HimRudra Orders <onboarding@resend.dev>';
  const { order, settings, requestId, fetchImpl } = params;

  if (!apiKey) {
    logStructured('info', 'notifications', 'order_email_skipped_unconfigured', {
      requestId,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      adminNotificationEmail: settings.emailNotificationsEnabled
        ? settings.orderNotificationEmail
        : undefined,
    });
    return {
      customerEmailSent: false,
      adminEmailSent: false,
      skippedReason: 'RESEND_API_KEY_NOT_CONFIGURED',
    };
  }

  const itemsText = order.items
    .map((it) => `- ${it.name} (${it.netQuantity}) × ${it.quantity} — ${formatInrPlain(it.unitPrice * it.quantity)}`)
    .join('\n');
  const itemsHtml = order.items
    .map(
      (it) =>
        `<li>${escapeHtml(it.name)} (${escapeHtml(it.netQuantity)}) &times; ${it.quantity} &mdash; <strong>${escapeHtml(formatInrPlain(it.unitPrice * it.quantity))}</strong></li>`
    )
    .join('');

  const addressLine = formatAddressLines(order);
  const paymentLine =
    order.paymentMethod === 'COD'
      ? 'Cash on Delivery (Payable at delivery)'
      : `${order.paymentMethod} (${order.paymentStatus}${order.razorpayPaymentId ? ` · Ref: ${order.razorpayPaymentId}` : ''})`;

  const customerText = [
    `Namaste ${order.customerName},`,
    '',
    `Thank you for your HimRudra order! Your order ${order.orderNumber} is confirmed.`,
    '',
    'Order Summary:',
    itemsText,
    `Total Amount: ${formatInrPlain(order.totalAmount)}`,
    `Payment: ${paymentLine}`,
    `Shipping Address: ${addressLine}`,
    order.estimatedDelivery ? `Estimated Delivery: ${order.estimatedDelivery}` : '',
    '',
    `For assistance, reply to this email or contact ${settings.brandEmail}.`,
    '— Team HimRudra',
  ]
    .filter(Boolean)
    .join('\n');

  const customerHtml = `
    <div style="font-family: Georgia, serif; color: #281A15; max-width: 600px; margin: 0 auto;">
      <h2 style="margin-bottom: 6px;">Order Confirmed — ${escapeHtml(order.orderNumber)}</h2>
      <p>Namaste ${escapeHtml(order.customerName)},</p>
      <p>Thank you for ordering from <strong>HimRudra</strong>. We have received your order and queued it for dispatch.</p>
      <ul>${itemsHtml}</ul>
      <p><strong>Total:</strong> ${escapeHtml(formatInrPlain(order.totalAmount))}<br/>
         <strong>Payment:</strong> ${escapeHtml(paymentLine)}<br/>
         <strong>Delivery Address:</strong> ${escapeHtml(addressLine)}${
           order.estimatedDelivery
             ? `<br/><strong>Estimated Delivery:</strong> ${escapeHtml(order.estimatedDelivery)}`
             : ''
         }</p>
      <p style="font-size: 13px; color: #79543D;">Questions? Reach us at ${escapeHtml(settings.brandEmail)}.</p>
    </div>
  `.trim();

  const customerRes = await sendViaResend({
    apiKey,
    from,
    to: order.customerEmail,
    replyTo: settings.brandEmail,
    subject: `HimRudra Order Confirmed — ${order.orderNumber}`,
    html: customerHtml,
    text: customerText,
    fetchImpl,
  });

  logStructured(customerRes.ok ? 'info' : 'warn', 'notifications', 'customer_order_email', {
    requestId,
    orderNumber: order.orderNumber,
    sent: customerRes.ok,
    ...(customerRes.error ? { error: customerRes.error } : {}),
  });

  let adminEmailSent = false;
  if (settings.emailNotificationsEnabled && settings.orderNotificationEmail?.trim()) {
    const adminText = [
      `New HimRudra Order: ${order.orderNumber}`,
      `Customer: ${order.customerName} (${order.customerEmail} | ${order.customerPhone})`,
      `Amount: ${formatInrPlain(order.totalAmount)}`,
      `Payment: ${paymentLine}`,
      `Shipping: ${addressLine}`,
      '',
      'Items:',
      itemsText,
    ].join('\n');

    const adminHtml = `
      <div style="font-family: system-ui, sans-serif; color: #281A15; max-width: 600px;">
        <h3>New Order Received — ${escapeHtml(order.orderNumber)}</h3>
        <p><strong>Customer:</strong> ${escapeHtml(order.customerName)} (${escapeHtml(order.customerEmail)} · ${escapeHtml(order.customerPhone)})<br/>
           <strong>Amount:</strong> ${escapeHtml(formatInrPlain(order.totalAmount))}<br/>
           <strong>Payment:</strong> ${escapeHtml(paymentLine)}<br/>
           <strong>Shipping:</strong> ${escapeHtml(addressLine)}</p>
        <ul>${itemsHtml}</ul>
      </div>
    `.trim();

    const adminRes = await sendViaResend({
      apiKey,
      from,
      to: settings.orderNotificationEmail.trim(),
      replyTo: order.customerEmail,
      subject: `New HimRudra Order ${order.orderNumber} (${formatInrPlain(order.totalAmount)})`,
      html: adminHtml,
      text: adminText,
      fetchImpl,
    });
    adminEmailSent = adminRes.ok;

    logStructured(adminRes.ok ? 'info' : 'warn', 'notifications', 'admin_order_email', {
      requestId,
      orderNumber: order.orderNumber,
      sent: adminRes.ok,
      ...(adminRes.error ? { error: adminRes.error } : {}),
    });
  }

  return {
    customerEmailSent: customerRes.ok,
    adminEmailSent,
  };
}
