var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server.ts
import crypto6 from "node:crypto";
import fs2 from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { GoogleGenAI } from "@google/genai";

// src/lib/commerce.ts
var FREE_SHIPPING_PROMO_END_ISO = "2026-11-30T23:59:59+05:30";
var IST_OFFSET_MS = 5.5 * 60 * 60 * 1e3;
function toIstDateString(isoOrMs) {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function isPromotionActive(promo, nowMs = Date.now()) {
  if (!promo.enabled) return false;
  const start = Date.parse(promo.startsAt);
  const end = Date.parse(promo.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return nowMs >= start && nowMs <= end;
}
function getActivePromotions(promotions2 = [], nowMs = Date.now()) {
  return promotions2.filter((p) => isPromotionActive(p, nowMs));
}
function calculateCartTotals(cartItems, products2, settings, options) {
  const shippingSpeed = options?.shippingSpeed ?? "standard";
  const paymentMethod = options?.paymentMethod ?? "UPI";
  const coupons2 = options?.coupons ?? [];
  const promotions2 = options?.promotions ?? [];
  const nowMs = options?.nowMs ?? Date.now();
  const code = (options?.couponCode ?? "").trim().toUpperCase();
  let itemCount = 0;
  let mrpTotal = 0;
  let subtotal = 0;
  let gstRateWeighted = 12;
  for (const item of cartItems) {
    if (item.quantity <= 0) continue;
    const product = products2.find((p) => p.id === item.productId);
    if (!product) continue;
    itemCount += item.quantity;
    mrpTotal += product.mrp * item.quantity;
    subtotal += product.price * item.quantity;
    gstRateWeighted = product.gstRatePercent;
  }
  const instantSavings = Math.max(0, mrpTotal - subtotal);
  const discountPercent = mrpTotal > 0 ? Math.round(instantSavings / mrpTotal * 100) : 0;
  let couponDiscount = 0;
  let appliedCoupon;
  let appliedPromotion;
  const activePromos = getActivePromotions(promotions2, nowMs);
  const automaticFreeShipPromo = activePromos.find(
    (p) => p.freeShipping && (!p.promoCode || !p.promoCode.trim())
  );
  const automaticDiscountPromo = activePromos.find(
    (p) => p.discountPercent > 0 && (!p.promoCode || !p.promoCode.trim())
  );
  const codeMatchedPromo = code ? activePromos.find((p) => p.promoCode && p.promoCode.trim().toUpperCase() === code) : void 0;
  if (codeMatchedPromo && subtotal > 0) {
    appliedPromotion = codeMatchedPromo;
    if (codeMatchedPromo.discountPercent > 0) {
      couponDiscount = Math.round(subtotal * codeMatchedPromo.discountPercent / 100);
      appliedCoupon = {
        code: codeMatchedPromo.promoCode.toUpperCase(),
        discountType: "percent",
        value: codeMatchedPromo.discountPercent,
        minOrderAmount: 0,
        active: true,
        description: codeMatchedPromo.title
      };
    }
  } else if (code && subtotal > 0) {
    const found = coupons2.find((c) => c.active && c.code.toUpperCase() === code);
    if (found && subtotal >= found.minOrderAmount) {
      appliedCoupon = found;
      couponDiscount = found.discountType === "percent" ? Math.round(subtotal * found.value / 100) : Math.min(found.value, subtotal);
    }
  } else if (automaticDiscountPromo && subtotal > 0) {
    appliedPromotion = automaticDiscountPromo;
    couponDiscount = Math.round(subtotal * automaticDiscountPromo.discountPercent / 100);
  }
  if (!appliedPromotion && automaticFreeShipPromo) {
    appliedPromotion = automaticFreeShipPromo;
  }
  const discountedSubtotal = Math.max(0, subtotal - couponDiscount);
  const promoGrantsFreeShipping = Boolean(
    appliedPromotion?.freeShipping && (appliedPromotion.freeShippingSpeed === "all" || shippingSpeed === "standard")
  );
  const hasFreeThreshold = settings.freeShippingThreshold > 0;
  const standardFee = Math.max(0, Number(settings.standardShippingFee) || 0);
  const freeShippingByNA = standardFee === 0;
  let shippingFee = 0;
  let freeShippingByPromo = false;
  if (itemCount > 0) {
    if (shippingSpeed === "express") {
      shippingFee = promoGrantsFreeShipping ? 0 : Math.max(0, Number(settings.expressShippingFee) || 0);
      freeShippingByPromo = promoGrantsFreeShipping;
    } else if (freeShippingByNA) {
      shippingFee = 0;
      freeShippingByPromo = false;
    } else if (promoGrantsFreeShipping) {
      shippingFee = 0;
      freeShippingByPromo = true;
    } else {
      shippingFee = hasFreeThreshold && discountedSubtotal >= settings.freeShippingThreshold ? 0 : standardFee;
    }
  }
  const freeShippingRemaining = itemCount > 0 && !freeShippingByNA && !promoGrantsFreeShipping && hasFreeThreshold && discountedSubtotal < settings.freeShippingThreshold ? settings.freeShippingThreshold - discountedSubtotal : 0;
  const configuredCodFee = Math.max(0, Number(settings.codFee) || 0);
  const codFee = itemCount > 0 && paymentMethod === "COD" ? configuredCodFee : 0;
  const grandTotal = discountedSubtotal + shippingFee + codFee;
  const gstMultiplier = 1 + gstRateWeighted / 100;
  const taxableValue = discountedSubtotal > 0 ? Math.round(discountedSubtotal / gstMultiplier * 100) / 100 : 0;
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
    freeShippingByNA
  };
}
function validateCheckoutForm(address) {
  const errors = {};
  const cleanPhone = address.phone.replace(/\D/g, "");
  const cleanPin = address.pincode.trim();
  if (!address.fullName || address.fullName.trim().length < 2) {
    errors.fullName = "Please enter recipient full name.";
  }
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
    errors.phone = "Enter a valid 10-digit Indian mobile number.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email.trim())) {
    errors.email = "Enter a valid email address for order updates.";
  }
  if (!address.line1 || address.line1.trim().length < 4) {
    errors.line1 = "Enter complete street / locality address.";
  }
  if (!address.city || address.city.trim().length < 2) {
    errors.city = "Enter city or town.";
  }
  if (!address.state || address.state.trim().length < 2) {
    errors.state = "Select or enter state.";
  }
  if (!/^[1-9][0-9]{5}$/.test(cleanPin)) {
    errors.pincode = "Enter a valid 6-digit Indian PIN code.";
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}
var ORDER_STAGES = [
  "Pending Payment",
  "Payment Confirmed",
  "Processing",
  "Packed",
  "Dispatched",
  "Out for Delivery",
  "Delivered"
];
var ALL_ORDER_STATUSES = [
  ...ORDER_STAGES,
  "Cancelled",
  "Refunded"
];
function normalizeLegacyOrderStatus(raw) {
  switch (raw) {
    case "Placed":
      return "Pending Payment";
    case "Confirmed":
      return "Payment Confirmed";
    case "Quality Checked":
      return "Packed";
    case "Shipped":
      return "Dispatched";
    case "Pending Payment":
    case "Payment Confirmed":
    case "Processing":
    case "Packed":
    case "Dispatched":
    case "Out for Delivery":
    case "Delivered":
    case "Cancelled":
    case "Refunded":
      return raw;
    default:
      return "Processing";
  }
}
function calculateProfitMetrics(orders2, expenses2, options) {
  const gatewayFeePercent = options?.gatewayFeePercent ?? 2;
  const defaultShippingCost = options?.defaultShippingCostPerOrder ?? 65;
  const nowMs = options?.nowMs ?? Date.now();
  const todayIst = toIstDateString(nowMs);
  const currentMonthIst = todayIst.slice(0, 7);
  const currentYearIst = todayIst.slice(0, 4);
  const activeOrders = orders2.filter(
    (o) => o.status !== "Cancelled" && o.status !== "Refunded"
  );
  const refundedOrders = orders2.filter(
    (o) => o.status === "Refunded" || o.paymentStatus === "Refunded"
  );
  const totalOrders = activeOrders.length;
  const totalPaidOrders = activeOrders.filter((o) => o.paymentStatus === "Paid").length;
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
  const dailyMap = /* @__PURE__ */ new Map();
  const weeklyMap = /* @__PURE__ */ new Map();
  const monthlyMap = /* @__PURE__ */ new Map();
  const annualMap = /* @__PURE__ */ new Map();
  const statusMap = /* @__PURE__ */ new Map();
  for (const ord of orders2) {
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
    const shipCost = typeof order.actualShippingCost === "number" ? order.actualShippingCost : defaultShippingCost;
    orderShippingExpenses += shipCost;
    const gwFee = typeof order.gatewayFeeAmount === "number" ? order.gatewayFeeAmount : order.paymentMethod !== "COD" && order.paymentStatus === "Paid" ? Math.round(order.totalAmount * (gatewayFeePercent / 100) * 100) / 100 : 0;
    gatewayFees += gwFee;
    const dEntry = dailyMap.get(orderIstDate) ?? {
      date: orderIstDate,
      revenue: 0,
      orders: 0
    };
    dEntry.revenue += order.totalAmount;
    dEntry.orders += 1;
    dailyMap.set(orderIstDate, dEntry);
    const dObj = /* @__PURE__ */ new Date(`${orderIstDate}T00:00:00Z`);
    const dayOfWeek = dObj.getUTCDay();
    const diffToMon = (dayOfWeek + 6) % 7;
    const monday = new Date(dObj.getTime() - diffToMon * 864e5);
    const weekKey = monday.toISOString().slice(0, 10);
    const wEntry = weeklyMap.get(weekKey) ?? { week: weekKey, orders: 0, revenue: 0 };
    wEntry.orders += 1;
    wEntry.revenue += order.totalAmount;
    weeklyMap.set(weekKey, wEntry);
    const existing = monthlyMap.get(monthKey) ?? {
      month: monthKey,
      revenue: 0,
      cogs: 0,
      shipExp: 0,
      gwFees: 0,
      opEx: 0,
      orders: 0
    };
    existing.revenue += order.totalAmount;
    existing.cogs += orderCogs;
    existing.shipExp += shipCost;
    existing.gwFees += gwFee;
    existing.orders += 1;
    monthlyMap.set(monthKey, existing);
    const yEntry = annualMap.get(yearKey) ?? {
      year: yearKey,
      revenue: 0,
      expenses: 0,
      orders: 0
    };
    yEntry.revenue += order.totalAmount;
    yEntry.expenses += orderCogs + shipCost + gwFee;
    yEntry.orders += 1;
    annualMap.set(yearKey, yEntry);
  }
  let operatingExpenses = 0;
  let loggedShippingExpense = 0;
  const catMap = /* @__PURE__ */ new Map();
  for (const exp of expenses2) {
    operatingExpenses += exp.amount;
    if (exp.category === "Shipping") {
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
      orders: 0
    };
    existing.opEx += exp.amount;
    monthlyMap.set(monthKey, existing);
    const yearKey = exp.date.slice(0, 4);
    const yEntry = annualMap.get(yearKey) ?? {
      year: yearKey,
      revenue: 0,
      expenses: 0,
      orders: 0
    };
    yEntry.expenses += exp.amount;
    annualMap.set(yearKey, yEntry);
  }
  const shippingExpenses = Math.round((orderShippingExpenses + loggedShippingExpense) * 100) / 100;
  const nonShippingOpEx = operatingExpenses - loggedShippingExpense;
  const roundedGatewayFees = Math.round(gatewayFees * 100) / 100;
  const netProfit = Math.round(
    (grossRevenue - totalCogs - shippingExpenses - roundedGatewayFees - nonShippingOpEx - refundsTotal) * 100
  ) / 100;
  const profitMarginPercent = grossRevenue > 0 ? Math.round(netProfit / grossRevenue * 1e3) / 10 : 0;
  const averageOrderValue = totalOrders > 0 ? Math.round(grossRevenue / totalOrders) : 0;
  const dailySales = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-14).map((d) => ({
    ...d,
    label: d.date.slice(5)
  }));
  const weeklyOrders = Array.from(weeklyMap.values()).sort((a, b) => a.week.localeCompare(b.week)).slice(-8);
  const monthlySeries = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)).map((entry) => {
    const totalExp = Math.round((entry.cogs + entry.shipExp + entry.gwFees + entry.opEx) * 100) / 100;
    return {
      month: entry.month,
      revenue: Math.round(entry.revenue * 100) / 100,
      expenses: totalExp,
      profit: Math.round((entry.revenue - totalExp) * 100) / 100,
      orders: entry.orders
    };
  });
  const annualSales = Array.from(annualMap.values()).sort((a, b) => a.year.localeCompare(b.year)).map((y) => ({
    year: y.year,
    revenue: Math.round(y.revenue * 100) / 100,
    profit: Math.round((y.revenue - y.expenses) * 100) / 100,
    orders: y.orders
  }));
  const statusDistribution = Array.from(statusMap.entries()).map(([status, count]) => ({
    status,
    count
  }));
  const expenseByCategory = Array.from(catMap.entries()).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
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
    expenseByCategory
  };
}
function isAuthorizedAdmin(user, ownerEmail) {
  if (!user || !ownerEmail) return false;
  return user.role === "admin" && typeof user.email === "string" && user.email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}
function normalizeInquiryPhone(rawPhone) {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return null;
}
function buildInquiryReplyLinks(inquiry, replyMessage, brandName = "HimRudra Support") {
  const recipientEmail = inquiry.email.trim();
  const recipientPhone = normalizeInquiryPhone(inquiry.phone);
  const cleanReply = replyMessage.trim();
  const cleanSubject = inquiry.subject?.trim() || "Your Inquiry";
  const subject = `Re: ${cleanSubject} \u2014 ${brandName}`;
  const formattedBody = [
    `Hello ${inquiry.name.trim() || "Customer"},`,
    "",
    cleanReply,
    "",
    "---",
    `Your original query (${cleanSubject}):`,
    inquiry.message.trim(),
    "",
    `Warm regards,`,
    brandName
  ].join("\n");
  const mailtoUrl = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(formattedBody)}`;
  const whatsappText = [
    `Hello ${inquiry.name.trim() || "Customer"}, regarding your HimRudra inquiry (${cleanSubject}):`,
    "",
    cleanReply,
    "",
    `\u2014 ${brandName}`
  ].join("\n");
  const whatsappUrl = recipientPhone ? `https://wa.me/${recipientPhone}?text=${encodeURIComponent(whatsappText)}` : null;
  const smsUrl = recipientPhone ? `sms:+${recipientPhone}?body=${encodeURIComponent(whatsappText)}` : null;
  return {
    recipientEmail,
    recipientPhone,
    subject,
    formattedBody,
    mailtoUrl,
    whatsappUrl,
    smsUrl
  };
}

// server/store.ts
import crypto2 from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// server/dynamodb.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";

// server/awsConfig.ts
function resolveAwsAuthMode(env = process.env, endpoint) {
  const accessKeyId = (env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY || "").trim();
  const sessionToken = (env.AWS_SESSION_TOKEN || "").trim() || void 0;
  if (accessKeyId && secretAccessKey) {
    return {
      authMode: "explicit-credentials",
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...sessionToken ? { sessionToken } : {}
      }
    };
  }
  const hasIamRuntime = Boolean(
    env.AWS_ROLE_ARN || env.AWS_WEB_IDENTITY_TOKEN_FILE || env.AWS_LAMBDA_FUNCTION_NAME || env.AWS_EXECUTION_ENV || env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  );
  if (hasIamRuntime) {
    return { authMode: "iam-role" };
  }
  if (endpoint) {
    return { authMode: "local-endpoint" };
  }
  return { authMode: "unconfigured" };
}
function getAwsDynamoConfig(env = process.env) {
  const storageOverride = (env.STORAGE_ENGINE || "").trim().toLowerCase();
  const tableName = (env.AWS_DYNAMODB_TABLE || "").trim();
  const region = (env.AWS_REGION || env.AWS_DEFAULT_REGION || "ap-south-1").trim();
  const endpoint = (env.AWS_DYNAMODB_ENDPOINT || "").trim() || void 0;
  if (storageOverride === "local-json") {
    return {
      enabled: false,
      region,
      tableName,
      endpoint,
      authMode: "unconfigured"
    };
  }
  const { authMode } = resolveAwsAuthMode(env, endpoint);
  const enabled = Boolean(tableName && authMode !== "unconfigured");
  return {
    enabled,
    region,
    tableName,
    endpoint,
    authMode
  };
}
function getAwsS3Config(env = process.env) {
  const bucket = (env.AWS_S3_BUCKET || "").trim();
  const region = (env.AWS_S3_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION || "ap-south-1").trim();
  const endpoint = (env.AWS_S3_ENDPOINT || "").trim() || void 0;
  const publicBaseUrl = (env.AWS_S3_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "") || void 0;
  const keyPrefix = (env.AWS_S3_KEY_PREFIX || "himrudra").trim().replace(/^\/+|\/+$/g, "");
  const { authMode } = resolveAwsAuthMode(env, endpoint);
  const enabled = Boolean(bucket && authMode !== "unconfigured");
  return {
    enabled,
    region,
    bucket,
    keyPrefix: keyPrefix || "himrudra",
    publicBaseUrl,
    endpoint,
    authMode
  };
}

// server/logger.ts
import crypto from "node:crypto";
var REDACTED_KEYS = /* @__PURE__ */ new Set([
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "secret",
  "secretaccesskey",
  "aws_secret_access_key",
  "accesskeyid",
  "aws_access_key_id",
  "sessiontoken",
  "authorization",
  "cookie",
  "idtoken",
  "token",
  "apikey",
  "razorpay_key_secret",
  "razorpay_webhook_secret"
]);
function redactSensitiveData(value, depth = 0) {
  if (depth > 5 || value === null || value === void 0) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactSensitiveData(item, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactSensitiveData(v, depth + 1);
    }
  }
  return out;
}
function createRequestId() {
  return `req_${crypto.randomBytes(6).toString("hex")}`;
}
function logStructured(level, component, action, meta) {
  const entry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    component,
    action,
    ...meta ? redactSensitiveData(meta) : {}
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// server/validation.ts
var MAX_DYNAMO_ITEM_BYTES = 380 * 1024;
var MAX_INLINE_DATA_URI_BYTES = 260 * 1024;
var StorePersistenceError = class extends Error {
  constructor(message, options) {
    super(message);
    this.name = "StorePersistenceError";
    this.code = options?.code || "STORE_PERSISTENCE_ERROR";
    this.statusCode = options?.statusCode || 503;
    this.retryable = Boolean(options?.retryable);
  }
};
function estimateDynamoItemBytes(item) {
  return Buffer.byteLength(JSON.stringify(item), "utf-8");
}
function assertDynamoItemsValid(items) {
  for (const item of items) {
    if (!item || typeof item.pk !== "string" || item.pk.trim().length === 0) {
      throw new StorePersistenceError("Invalid DynamoDB record: missing primary key (pk).", {
        code: "INVALID_RECORD_PK",
        statusCode: 400
      });
    }
    if (!item.entityType) {
      throw new StorePersistenceError(`Invalid DynamoDB record "${item.pk}": missing entityType.`, {
        code: "INVALID_RECORD_TYPE",
        statusCode: 400
      });
    }
    const bytes = estimateDynamoItemBytes(item);
    if (bytes > MAX_DYNAMO_ITEM_BYTES) {
      const kb = Math.round(bytes / 1024);
      throw new StorePersistenceError(
        `Record "${item.pk}" is ${kb} KB, which exceeds DynamoDB's safe item size limit (380 KB). Configure AWS_S3_BUCKET to store large product images or lab PDFs in AWS S3.`,
        {
          code: "DYNAMO_ITEM_TOO_LARGE",
          statusCode: 413,
          retryable: false
        }
      );
    }
  }
}
function sanitizeUploadedFileName(fileName) {
  const cleaned = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120);
  return cleaned || "upload.bin";
}
function validateAllowedUploadMime(mimeType) {
  const normalized = (mimeType || "").trim().toLowerCase();
  const allowed = /* @__PURE__ */ new Set([
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp"
  ]);
  if (!allowed.has(normalized)) {
    return { valid: false, safeMime: "" };
  }
  return {
    valid: true,
    safeMime: normalized === "image/jpg" ? "image/jpeg" : normalized
  };
}

// server/dynamodb.ts
function getDynamoConfig(env = process.env) {
  return getAwsDynamoConfig(env);
}
function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}
function serializeStateToDynamoItems(state, updatedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const items = [
    {
      pk: "META#settings",
      entityType: "settings",
      payload: stripUndefined(state.settings),
      updatedAt
    },
    {
      pk: "META#coupons",
      entityType: "coupons",
      payload: stripUndefined(state.coupons),
      updatedAt
    },
    {
      pk: "META#promotions",
      entityType: "promotions",
      payload: stripUndefined(state.promotions),
      updatedAt
    },
    {
      pk: "META#cmsSections",
      entityType: "cmsSections",
      payload: stripUndefined(state.cmsSections),
      updatedAt
    },
    {
      pk: "META#expenses",
      entityType: "expenses",
      payload: stripUndefined(state.expenses),
      updatedAt
    },
    {
      pk: "META#adminNotifications",
      entityType: "adminNotifications",
      payload: stripUndefined(state.adminNotifications),
      updatedAt
    },
    {
      pk: "META#paymentIntents",
      entityType: "paymentIntents",
      payload: stripUndefined(state.paymentIntents),
      updatedAt
    }
  ];
  state.users.forEach((user, idx) => {
    items.push({
      pk: `USER#${user.id}`,
      entityType: "user",
      sortOrder: idx,
      payload: stripUndefined(user),
      updatedAt
    });
  });
  state.products.forEach((product, idx) => {
    items.push({
      pk: `PRODUCT#${product.id}`,
      entityType: "product",
      sortOrder: idx,
      payload: stripUndefined(product),
      updatedAt
    });
  });
  state.orders.forEach((order, idx) => {
    items.push({
      pk: `ORDER#${order.id}`,
      entityType: "order",
      sortOrder: idx,
      payload: stripUndefined(order),
      updatedAt
    });
  });
  state.labReports.forEach((report, idx) => {
    items.push({
      pk: `LABREPORT#${report.id}`,
      entityType: "labReport",
      sortOrder: idx,
      payload: stripUndefined(report),
      updatedAt
    });
  });
  state.inquiries.forEach((inquiry, idx) => {
    items.push({
      pk: `INQUIRY#${inquiry.id}`,
      entityType: "inquiry",
      sortOrder: idx,
      payload: stripUndefined(inquiry),
      updatedAt
    });
  });
  return items;
}
function deserializeDynamoItemsToState(items, fallbackSeed) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const byPk = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (item && typeof item.pk === "string") {
      byPk.set(item.pk, item);
    }
  }
  const sortByOrder = (a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);
  const users2 = items.filter((i) => i.entityType === "user" || i.pk.startsWith("USER#")).sort(sortByOrder).map((i) => i.payload);
  const products2 = items.filter((i) => i.entityType === "product" || i.pk.startsWith("PRODUCT#")).sort(sortByOrder).map((i) => i.payload);
  const orders2 = items.filter((i) => i.entityType === "order" || i.pk.startsWith("ORDER#")).sort(sortByOrder).map((i) => i.payload);
  const labReports2 = items.filter((i) => i.entityType === "labReport" || i.pk.startsWith("LABREPORT#")).sort(sortByOrder).map((i) => i.payload);
  const inquiries2 = items.filter((i) => i.entityType === "inquiry" || i.pk.startsWith("INQUIRY#")).sort(sortByOrder).map((i) => i.payload);
  const getMeta = (pk, fallback) => {
    const found = byPk.get(pk);
    return found && found.payload !== void 0 ? found.payload : fallback;
  };
  return {
    users: users2.length > 0 ? users2 : fallbackSeed.users,
    products: products2.length > 0 ? products2 : fallbackSeed.products,
    settings: getMeta("META#settings", fallbackSeed.settings),
    coupons: getMeta("META#coupons", fallbackSeed.coupons),
    promotions: getMeta("META#promotions", fallbackSeed.promotions),
    orders: orders2,
    labReports: labReports2.length > 0 ? labReports2 : fallbackSeed.labReports,
    cmsSections: getMeta("META#cmsSections", fallbackSeed.cmsSections),
    expenses: getMeta("META#expenses", fallbackSeed.expenses),
    inquiries: inquiries2,
    adminNotifications: getMeta("META#adminNotifications", fallbackSeed.adminNotifications),
    paymentIntents: getMeta("META#paymentIntents", fallbackSeed.paymentIntents)
  };
}
function buildItemFingerprint(item) {
  return JSON.stringify({
    entityType: item.entityType,
    sortOrder: item.sortOrder,
    payload: item.payload
  });
}
function computeDynamoDiff(previousFingerprints, nextItems) {
  const nextFingerprints = /* @__PURE__ */ new Map();
  const toPut = [];
  for (const item of nextItems) {
    const fp = buildItemFingerprint(item);
    nextFingerprints.set(item.pk, fp);
    if (previousFingerprints.get(item.pk) !== fp) {
      toPut.push(item);
    }
  }
  const toDeletePks = [];
  for (const prevPk of previousFingerprints.keys()) {
    if (!nextFingerprints.has(prevPk)) {
      toDeletePks.push(prevPk);
    }
  }
  return { toPut, toDeletePks, nextFingerprints };
}
var DynamoStateAdapter = class {
  constructor(config) {
    this.config = config;
    const { credentials } = resolveAwsAuthMode(process.env, config.endpoint);
    const client = new DynamoDBClient({
      region: config.region,
      maxAttempts: 4,
      retryMode: "adaptive",
      ...config.endpoint ? { endpoint: config.endpoint } : {},
      ...credentials ? { credentials } : {}
    });
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false
      }
    });
  }
  async loadAllItems() {
    const startedAt = Date.now();
    const items = [];
    let exclusiveStartKey;
    try {
      do {
        const response = await this.docClient.send(
          new ScanCommand({
            TableName: this.config.tableName,
            ExclusiveStartKey: exclusiveStartKey
          })
        );
        if (Array.isArray(response.Items)) {
          for (const raw of response.Items) {
            items.push(raw);
          }
        }
        exclusiveStartKey = response.LastEvaluatedKey;
      } while (exclusiveStartKey);
      logStructured("info", "aws-dynamodb", "scan_complete", {
        table: this.config.tableName,
        itemCount: items.length,
        durationMs: Date.now() - startedAt
      });
      return items;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "DynamoDB scan failed";
      logStructured("error", "aws-dynamodb", "scan_failed", {
        table: this.config.tableName,
        durationMs: Date.now() - startedAt,
        error: msg
      });
      throw new StorePersistenceError(`AWS DynamoDB read failed: ${msg}`, {
        code: "DYNAMO_READ_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  async applyDiff(toPut, toDeletePks) {
    if (toPut.length === 0 && toDeletePks.length === 0) return;
    assertDynamoItemsValid(toPut);
    const startedAt = Date.now();
    const requests = [
      ...toPut.map((item) => ({ PutRequest: { Item: item } })),
      ...toDeletePks.map((pk) => ({ DeleteRequest: { Key: { pk } } }))
    ];
    try {
      for (let i = 0; i < requests.length; i += 25) {
        let batch = requests.slice(i, i + 25);
        let attempt = 0;
        while (batch.length > 0 && attempt < 5) {
          const res = await this.docClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [this.config.tableName]: batch
              }
            })
          );
          const unprocessed = res.UnprocessedItems?.[this.config.tableName];
          if (!unprocessed || unprocessed.length === 0) {
            break;
          }
          batch = unprocessed;
          attempt += 1;
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt * attempt));
        }
        if (batch.length > 0 && attempt >= 5) {
          throw new StorePersistenceError(
            `DynamoDB throttled ${batch.length} item(s) after retries. Please retry.`,
            { code: "DYNAMO_THROTTLED", statusCode: 503, retryable: true }
          );
        }
      }
      logStructured("info", "aws-dynamodb", "batch_write_complete", {
        table: this.config.tableName,
        puts: toPut.length,
        deletes: toDeletePks.length,
        durationMs: Date.now() - startedAt
      });
    } catch (err) {
      if (err instanceof StorePersistenceError) throw err;
      const msg = err instanceof Error ? err.message : "DynamoDB write failed";
      logStructured("error", "aws-dynamodb", "batch_write_failed", {
        table: this.config.tableName,
        puts: toPut.length,
        deletes: toDeletePks.length,
        durationMs: Date.now() - startedAt,
        error: msg
      });
      throw new StorePersistenceError(`AWS DynamoDB write failed: ${msg}`, {
        code: "DYNAMO_WRITE_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  /**
   * Atomically creates a new Order item and conditionally decrements each Product's stock
   * in a single DynamoDB transaction so 500 concurrent checkouts can never oversell inventory.
   */
  async transactCreateOrderAndDecrementStock(params) {
    assertDynamoItemsValid([params.orderItem]);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const startedAt = Date.now();
    const transactItems = [
      {
        Put: {
          TableName: this.config.tableName,
          Item: params.orderItem,
          ConditionExpression: "attribute_not_exists(pk)"
        }
      },
      ...params.stockDecrements.map((dec) => ({
        Update: {
          TableName: this.config.tableName,
          Key: { pk: `PRODUCT#${dec.productId}` },
          UpdateExpression: "SET payload.stock = payload.stock - :qty, updatedAt = :now",
          ConditionExpression: "attribute_exists(pk) AND payload.stock >= :qty",
          ExpressionAttributeValues: {
            ":qty": dec.quantity,
            ":now": nowIso
          }
        }
      }))
    ];
    try {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems
        })
      );
      logStructured("info", "aws-dynamodb", "order_transaction_committed", {
        table: this.config.tableName,
        orderPk: params.orderItem.pk,
        itemsCount: params.stockDecrements.length,
        durationMs: Date.now() - startedAt
      });
    } catch (err) {
      const errName = typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
      const msg = err instanceof Error ? err.message : "Transaction failed";
      logStructured("error", "aws-dynamodb", "order_transaction_failed", {
        table: this.config.tableName,
        orderPk: params.orderItem.pk,
        errorName: errName,
        durationMs: Date.now() - startedAt,
        error: msg
      });
      if (errName === "TransactionCanceledException") {
        throw new StorePersistenceError(
          "Stock changed while placing your order or this order was already submitted. Please refresh your cart and try again.",
          { code: "ORDER_CONFLICT_OR_OUT_OF_STOCK", statusCode: 409, retryable: false }
        );
      }
      throw new StorePersistenceError(`Could not save order to AWS DynamoDB: ${msg}`, {
        code: "DYNAMO_TRANSACTION_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
};

// src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  adminNotifications: () => adminNotifications,
  cmsSections: () => cmsSections,
  coupons: () => coupons,
  expenses: () => expenses,
  inquiries: () => inquiries,
  labReports: () => labReports,
  orders: () => orders,
  ordersRelations: () => ordersRelations,
  paymentIntents: () => paymentIntents,
  products: () => products,
  promotions: () => promotions,
  storeSettings: () => storeSettings,
  users: () => users,
  usersRelations: () => usersRelations
});
import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp
} from "drizzle-orm/pg-core";
var users = pgTable("users", {
  id: text("id").primaryKey(),
  uid: text("uid").unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull().default(""),
  role: text("role").notNull().default("customer"),
  passwordHash: text("password_hash").notNull(),
  defaultAddress: jsonb("default_address").$type(),
  wishlistProductIds: jsonb("wishlist_product_ids").$type().notNull().default([]),
  createdAt: text("created_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow()
});
var products = pgTable("products", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull(),
  netQuantity: text("net_quantity").notNull(),
  sku: text("sku").notNull(),
  hsnCode: text("hsn_code").notNull(),
  mrp: doublePrecision("mrp").notNull(),
  price: doublePrecision("price").notNull(),
  costPerUnit: doublePrecision("cost_per_unit").notNull(),
  stock: integer("stock").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(10),
  batchNumber: text("batch_number").notNull(),
  gstRatePercent: doublePrecision("gst_rate_percent").notNull().default(12),
  shortDescription: text("short_description").notNull(),
  usageGuidance: text("usage_guidance").notNull(),
  storageInstructions: text("storage_instructions").notNull(),
  shippingNote: text("shipping_note").notNull(),
  returnPolicy: text("return_policy").notNull(),
  specifications: jsonb("specifications").$type().notNull().default([]),
  galleryTypes: jsonb("gallery_types").$type().notNull().default([]),
  customImages: jsonb("custom_images").$type(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow()
});
var orders = pgTable("orders", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  orderNumber: text("order_number").notNull().unique(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  shippingAddress: jsonb("shipping_address").$type().notNull(),
  deliveryInstructions: text("delivery_instructions"),
  items: jsonb("items").$type().notNull(),
  subtotal: doublePrecision("subtotal").notNull(),
  mrpTotal: doublePrecision("mrp_total").notNull(),
  instantSavings: doublePrecision("instant_savings").notNull(),
  couponCode: text("coupon_code"),
  couponDiscount: doublePrecision("coupon_discount").notNull().default(0),
  promotionId: text("promotion_id"),
  promotionTitle: text("promotion_title"),
  shippingFee: doublePrecision("shipping_fee").notNull().default(0),
  shippingSpeed: text("shipping_speed").notNull().default("standard"),
  codFee: doublePrecision("cod_fee").notNull().default(0),
  taxableValue: doublePrecision("taxable_value").notNull(),
  gstAmount: doublePrecision("gst_amount").notNull(),
  totalAmount: doublePrecision("total_amount").notNull(),
  gatewayFeeAmount: doublePrecision("gateway_fee_amount"),
  actualShippingCost: doublePrecision("actual_shipping_cost"),
  paymentMethod: text("payment_method").notNull(),
  paymentStatus: text("payment_status").notNull(),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id"),
  paymentVerifiedAt: text("payment_verified_at"),
  status: text("status").notNull(),
  trackingNumber: text("tracking_number"),
  courierName: text("courier_name"),
  trackingUrl: text("tracking_url"),
  estimatedDelivery: text("estimated_delivery"),
  dispatchedAt: text("dispatched_at"),
  deliveredAt: text("delivered_at"),
  refundAmount: doublePrecision("refund_amount"),
  refundReason: text("refund_reason"),
  refundRequestedAt: text("refund_requested_at"),
  timeline: jsonb("timeline").$type().notNull().default([]),
  createdAt: text("created_at").notNull()
});
var coupons = pgTable("coupons", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  code: text("code").notNull().unique(),
  type: text("type").notNull(),
  value: doublePrecision("value").notNull(),
  minOrderValue: doublePrecision("min_order_value").notNull().default(0),
  maxDiscount: doublePrecision("max_discount"),
  active: boolean("active").notNull().default(true),
  description: text("description").notNull()
});
var promotions = pgTable("promotions", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description").notNull(),
  bannerHeadline: text("banner_headline").notNull(),
  bannerSubtext: text("banner_subtext").notNull(),
  bannerTheme: text("banner_theme").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  freeShipping: boolean("free_shipping").notNull().default(false),
  freeShippingSpeed: text("free_shipping_speed").notNull().default("standard"),
  discountPercent: doublePrecision("discount_percent").notNull().default(0),
  promoCode: text("promo_code"),
  enabled: boolean("enabled").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  revenueGenerated: doublePrecision("revenue_generated").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
var labReports = pgTable("lab_reports", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  batchNumber: text("batch_number").notNull().default(""),
  testedBatchNumber: text("tested_batch_number").notNull(),
  reportNumber: text("report_number").notNull(),
  laboratoryName: text("laboratory_name").notNull(),
  accreditation: text("accreditation").notNull().default(""),
  testDate: text("test_date").notNull(),
  expiryDate: text("expiry_date").notNull().default(""),
  sampleDescription: text("sample_description").notNull().default(""),
  fulvicAcidPercent: text("fulvic_acid_percent").notNull().default(""),
  heavyMetals: jsonb("heavy_metals").$type().notNull().default([]),
  microbiological: jsonb("microbiological").$type().notNull().default([]),
  verdict: text("verdict").notNull().default("Reference Sample"),
  summaryNote: text("summary_note").notNull().default(""),
  mappedProductIds: jsonb("mapped_product_ids").$type().notNull().default([]),
  testingMethodology: text("testing_methodology").notNull().default(""),
  verifiedStatus: text("verified_status").notNull().default("Reference Sample"),
  notes: text("notes").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
  customDocumentUrl: text("custom_document_url"),
  originalFileName: text("original_file_name"),
  originalMimeType: text("original_mime_type")
});
var cmsSections = pgTable("cms_sections", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  key: text("key").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  content: text("content").notNull(),
  approvedByAdmin: boolean("approved_by_admin").notNull().default(false),
  approvedAt: text("approved_at"),
  updatedAt: text("updated_at").notNull()
});
var expenses = pgTable("expenses", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  date: text("date").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: doublePrecision("amount").notNull()
});
var inquiries = pgTable("inquiries", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("New"),
  replyMessage: text("reply_message"),
  repliedAt: text("replied_at"),
  repliedVia: jsonb("replied_via").$type(),
  emailDeliveryStatus: text("email_delivery_status"),
  createdAt: text("created_at").notNull()
});
var adminNotifications = pgTable("admin_notifications", {
  id: text("id").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  orderId: text("order_id"),
  orderNumber: text("order_number"),
  customerName: text("customer_name"),
  amount: doublePrecision("amount"),
  read: boolean("read").notNull().default(false),
  emailNotifiedTo: text("email_notified_to"),
  createdAt: text("created_at").notNull()
});
var paymentIntents = pgTable("payment_intents", {
  razorpayOrderId: text("razorpay_order_id").primaryKey(),
  amountPaise: integer("amount_paise").notNull(),
  verified: boolean("verified").notNull().default(false),
  paymentId: text("payment_id"),
  signatureVerified: boolean("signature_verified").notNull().default(false),
  method: text("method").notNull(),
  createdAt: text("created_at").notNull()
});
var storeSettings = pgTable("store_settings", {
  id: text("id").primaryKey(),
  payload: jsonb("payload").$type().notNull(),
  updatedAt: timestamp("updated_at").defaultNow()
});
var usersRelations = relations(users, ({ many }) => ({
  orders: many(orders)
}));
var ordersRelations = relations(orders, ({ one }) => ({
  customer: one(users, {
    fields: [orders.userId],
    references: [users.id]
  })
}));

// src/db/index.ts
function getExternalPostgresUrl(env = process.env) {
  const raw = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim() || env.POSTGRES_PRISMA_URL?.trim() || "";
  return raw.startsWith("postgres://") || raw.startsWith("postgresql://") ? raw : null;
}
function isUsingExternalPostgresUrl(env = process.env) {
  const hasCloudSqlObjectVars = Boolean(
    env.SQL_HOST?.trim() && env.SQL_USER?.trim() && env.SQL_PASSWORD?.trim() && env.SQL_DB_NAME?.trim()
  );
  if (hasCloudSqlObjectVars) return false;
  return Boolean(getExternalPostgresUrl(env));
}
function isCloudSqlConfigured(env = process.env) {
  const override = (env.STORAGE_ENGINE || "").trim().toLowerCase();
  if (override === "local-json" || override === "aws-dynamodb") {
    return false;
  }
  const hasObjectVars = Boolean(
    env.SQL_HOST?.trim() && env.SQL_USER?.trim() && env.SQL_PASSWORD?.trim() && env.SQL_DB_NAME?.trim()
  );
  return hasObjectVars || Boolean(getExternalPostgresUrl(env));
}
var createPool = () => {
  if (!global._postgresPool) {
    const hasObjectVars = Boolean(
      process.env.SQL_HOST?.trim() && process.env.SQL_USER?.trim() && process.env.SQL_PASSWORD?.trim() && process.env.SQL_DB_NAME?.trim()
    );
    const externalUrl = hasObjectVars ? null : getExternalPostgresUrl(process.env);
    if (externalUrl) {
      const parsed = new URL(externalUrl);
      const sslDisabled = parsed.searchParams.get("sslmode") === "disable" || (process.env.SQL_SSL || "").trim().toLowerCase() === "false";
      global._postgresPool = new Pool({
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ""),
        ...sslDisabled ? {} : { ssl: { rejectUnauthorized: false } },
        max: process.env.VERCEL ? 3 : 10,
        idleTimeoutMillis: process.env.VERCEL ? 1e4 : 3e4,
        connectionTimeoutMillis: process.env.VERCEL ? 8e3 : 15e3,
        keepAlive: true,
        allowExitOnIdle: Boolean(process.env.VERCEL)
      });
    } else {
      const sslMode = (process.env.SQL_SSL || "").trim().toLowerCase();
      const useSsl = sslMode === "true" || sslMode === "require" || sslMode === "1";
      const parsedPort = process.env.SQL_PORT ? Number(process.env.SQL_PORT) : void 0;
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        ...Number.isFinite(parsedPort) ? { port: parsedPort } : {},
        ...useSsl ? { ssl: { rejectUnauthorized: false } } : {},
        max: 15,
        idleTimeoutMillis: 3e4,
        connectionTimeoutMillis: process.env.VERCEL ? 15e3 : 2e4
      });
    }
    global._postgresPool.on("error", (err) => {
      console.error("Unexpected error on idle SQL pool client:", err);
    });
  }
  return global._postgresPool;
};
var pool = createPool();
var db = drizzle(pool, { schema: schema_exports });

// src/db/postgresAdapter.ts
import { and, asc, desc, eq, gte, notInArray, or, sql } from "drizzle-orm";
function getPgErrorCode(error) {
  if (!error || typeof error !== "object") return "";
  const direct = error.code;
  if (typeof direct === "string" && direct) return direct;
  const cause = error.cause;
  if (cause && typeof cause.code === "string") return cause.code;
  return "";
}
function isUndefinedTableError(error) {
  if (getPgErrorCode(error) === "42P01") return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /relation ["']?[a-z_]+["']? does not exist/i.test(msg);
}
function isTransientConnectionError(error) {
  const code = getPgErrorCode(error);
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE" || code === "57P01" || code === "08006" || code === "08003") {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|Connection terminated unexpectedly|terminating connection|socket hang up/i.test(
    msg
  );
}
var EXTERNAL_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  uid text UNIQUE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'customer',
  password_hash text NOT NULL,
  default_address jsonb,
  wishlist_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at text NOT NULL,
  updated_at timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  subtitle text NOT NULL,
  net_quantity text NOT NULL,
  sku text NOT NULL,
  hsn_code text NOT NULL,
  mrp double precision NOT NULL,
  price double precision NOT NULL,
  cost_per_unit double precision NOT NULL,
  stock integer NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 10,
  batch_number text NOT NULL,
  gst_rate_percent double precision NOT NULL DEFAULT 12,
  short_description text NOT NULL,
  usage_guidance text NOT NULL,
  storage_instructions text NOT NULL,
  shipping_note text NOT NULL,
  return_policy text NOT NULL,
  specifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  gallery_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_images jsonb,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamp DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  order_number text NOT NULL UNIQUE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text NOT NULL,
  shipping_address jsonb NOT NULL,
  delivery_instructions text,
  items jsonb NOT NULL,
  subtotal double precision NOT NULL,
  mrp_total double precision NOT NULL,
  instant_savings double precision NOT NULL,
  coupon_code text,
  coupon_discount double precision NOT NULL DEFAULT 0,
  promotion_id text,
  promotion_title text,
  shipping_fee double precision NOT NULL DEFAULT 0,
  shipping_speed text NOT NULL DEFAULT 'standard',
  cod_fee double precision NOT NULL DEFAULT 0,
  taxable_value double precision NOT NULL,
  gst_amount double precision NOT NULL,
  total_amount double precision NOT NULL,
  gateway_fee_amount double precision,
  actual_shipping_cost double precision,
  payment_method text NOT NULL,
  payment_status text NOT NULL,
  razorpay_order_id text,
  razorpay_payment_id text,
  payment_verified_at text,
  status text NOT NULL,
  tracking_number text,
  courier_name text,
  tracking_url text,
  estimated_delivery text,
  dispatched_at text,
  delivered_at text,
  refund_amount double precision,
  refund_reason text,
  refund_requested_at text,
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS coupons (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  code text NOT NULL UNIQUE,
  type text NOT NULL,
  value double precision NOT NULL,
  min_order_value double precision NOT NULL DEFAULT 0,
  max_discount double precision,
  active boolean NOT NULL DEFAULT true,
  description text NOT NULL
);
CREATE TABLE IF NOT EXISTS promotions (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text NOT NULL,
  banner_headline text NOT NULL,
  banner_subtext text NOT NULL,
  banner_theme text NOT NULL,
  starts_at text NOT NULL,
  ends_at text NOT NULL,
  free_shipping boolean NOT NULL DEFAULT false,
  free_shipping_speed text NOT NULL DEFAULT 'standard',
  discount_percent double precision NOT NULL DEFAULT 0,
  promo_code text,
  enabled boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0,
  revenue_generated double precision NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS lab_reports (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  batch_number text NOT NULL DEFAULT '',
  tested_batch_number text NOT NULL,
  report_number text NOT NULL,
  laboratory_name text NOT NULL,
  accreditation text NOT NULL DEFAULT '',
  test_date text NOT NULL,
  expiry_date text NOT NULL DEFAULT '',
  sample_description text NOT NULL DEFAULT '',
  fulvic_acid_percent text NOT NULL DEFAULT '',
  heavy_metals jsonb NOT NULL DEFAULT '[]'::jsonb,
  microbiological jsonb NOT NULL DEFAULT '[]'::jsonb,
  verdict text NOT NULL DEFAULT 'Reference Sample',
  summary_note text NOT NULL DEFAULT '',
  mapped_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  testing_methodology text NOT NULL DEFAULT '',
  verified_status text NOT NULL DEFAULT 'Reference Sample',
  notes text NOT NULL DEFAULT '',
  updated_at text NOT NULL DEFAULT '',
  custom_document_url text,
  original_file_name text,
  original_mime_type text
);
CREATE TABLE IF NOT EXISTS cms_sections (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  key text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  content text NOT NULL,
  approved_by_admin boolean NOT NULL DEFAULT false,
  approved_at text,
  updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  date text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS inquiries (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'New',
  reply_message text,
  replied_at text,
  replied_via jsonb,
  email_delivery_status text,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_notifications (
  id text PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  order_id text,
  order_number text,
  customer_name text,
  amount double precision,
  read boolean NOT NULL DEFAULT false,
  email_notified_to text,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_intents (
  razorpay_order_id text PRIMARY KEY,
  amount_paise integer NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  payment_id text,
  signature_verified boolean NOT NULL DEFAULT false,
  method text NOT NULL,
  created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS store_settings (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamp DEFAULT now()
);
`;
function isTableEmpty(state) {
  return state.userCount === 0 && state.productCount === 0 && state.settingsCount === 0;
}
var PostgresStateAdapter = class {
  constructor() {
    this.externalSchemaReady = false;
    this.externalSchemaPromise = null;
  }
  /**
   * Lazily provisions the 12 relational tables in a single SQL batch ONLY if an external
   * Postgres database (e.g., fresh Neon DB via DATABASE_URL) reports undefined_table (42P01).
   * Eliminates 12 sequential DDL round-trips from every Vercel cold start.
   */
  async ensureExternalSchemaIfNeeded() {
    if (this.externalSchemaReady || !isUsingExternalPostgresUrl()) return;
    if (this.externalSchemaPromise) {
      await this.externalSchemaPromise;
      return;
    }
    const startedAt = Date.now();
    this.externalSchemaPromise = (async () => {
      const pool2 = createPool();
      await pool2.query(EXTERNAL_SCHEMA_DDL);
      this.externalSchemaReady = true;
      logStructured("info", "cloud-sql", "external_schema_bootstrapped", {
        durationMs: Date.now() - startedAt
      });
    })().finally(() => {
      this.externalSchemaPromise = null;
    });
    await this.externalSchemaPromise;
  }
  /**
   * Executes a Postgres operation without upfront DDL round-trips.
   * Automatically bootstraps external schema once on 42P01 and retries once on transient
   * idle-socket resets (common when Neon compute wakes from scale-to-zero).
   */
  async runWithRecovery(operation) {
    try {
      return await operation();
    } catch (error) {
      if (isUsingExternalPostgresUrl() && isUndefinedTableError(error)) {
        await this.ensureExternalSchemaIfNeeded();
        return await operation();
      }
      if (isTransientConnectionError(error)) {
        logStructured("warn", "cloud-sql", "transient_connection_retry", {
          code: getPgErrorCode(error) || "connection_reset"
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        return await operation();
      }
      throw error;
    }
  }
  /**
   * Single-round-trip public storefront bootstrap query.
   * Fetches ONLY the 6 public tables (products, store_settings, coupons, promotions,
   * lab_reports, cms_sections) using one SQL query over one pooled connection — avoiding
   * full 12-table hydration and private tables (users, orders, expenses, inquiries, etc.).
   */
  async loadPublicBootstrap() {
    const startedAt = Date.now();
    try {
      const result = await this.runWithRecovery(async () => {
        const pool2 = createPool();
        return pool2.query(`
          SELECT
            (SELECT COALESCE(json_agg(t ORDER BY t.sort_order ASC), '[]'::json)
             FROM products t WHERE t.active = true) AS products,
            (SELECT COALESCE(json_agg(t ORDER BY t.sort_order ASC), '[]'::json)
             FROM coupons t WHERE t.active = true) AS coupons,
            (SELECT COALESCE(json_agg(t ORDER BY t.sort_order ASC), '[]'::json)
             FROM promotions t) AS promotions,
            (SELECT COALESCE(json_agg(t ORDER BY t.sort_order ASC), '[]'::json)
             FROM lab_reports t) AS lab_reports,
            (SELECT COALESCE(json_agg(t ORDER BY t.sort_order ASC), '[]'::json)
             FROM cms_sections t WHERE t.approved_by_admin = true) AS cms_sections,
            (SELECT payload FROM store_settings WHERE id = 'default' LIMIT 1) AS settings
        `);
      });
      const dbMs = Date.now() - startedAt;
      const row = result.rows[0];
      const rawProducts = Array.isArray(row?.products) ? row.products : [];
      const rawCoupons = Array.isArray(row?.coupons) ? row.coupons : [];
      const rawPromotions = Array.isArray(row?.promotions) ? row.promotions : [];
      const rawLabReports = Array.isArray(row?.lab_reports) ? row.lab_reports : [];
      const rawCms = Array.isArray(row?.cms_sections) ? row.cms_sections : [];
      const rawSettings = row?.settings ?? null;
      if (rawProducts.length === 0 && !rawSettings) {
        return {
          empty: true,
          data: {
            products: [],
            settings: null,
            coupons: [],
            promotions: [],
            labReports: [],
            cmsSections: []
          },
          dbMs
        };
      }
      const mappedProducts = rawProducts.map((r) => ({
        id: String(r.id),
        slug: String(r.slug),
        name: String(r.name),
        subtitle: String(r.subtitle),
        netQuantity: String(r.net_quantity),
        sku: String(r.sku),
        hsnCode: String(r.hsn_code),
        mrp: Number(r.mrp),
        price: Number(r.price),
        costPerUnit: Number(r.cost_per_unit),
        stock: Number(r.stock),
        lowStockThreshold: Number(r.low_stock_threshold),
        batchNumber: String(r.batch_number),
        gstRatePercent: Number(r.gst_rate_percent),
        shortDescription: String(r.short_description),
        usageGuidance: String(r.usage_guidance),
        storageInstructions: String(r.storage_instructions),
        shippingNote: String(r.shipping_note),
        returnPolicy: String(r.return_policy),
        specifications: Array.isArray(r.specifications) ? r.specifications : [],
        galleryTypes: Array.isArray(r.gallery_types) ? r.gallery_types : [],
        customImages: Array.isArray(r.custom_images) ? r.custom_images : void 0,
        active: Boolean(r.active)
      }));
      const mappedCoupons = rawCoupons.map((r) => ({
        code: String(r.code),
        discountType: r.type === "flat" ? "flat" : "percent",
        value: Number(r.value),
        minOrderAmount: Number(r.min_order_value),
        active: Boolean(r.active),
        description: String(r.description)
      }));
      const mappedPromotions = rawPromotions.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        description: String(r.description),
        bannerHeadline: String(r.banner_headline),
        bannerSubtext: String(r.banner_subtext),
        bannerTheme: r.banner_theme,
        startsAt: String(r.starts_at),
        endsAt: String(r.ends_at),
        freeShipping: Boolean(r.free_shipping),
        freeShippingSpeed: r.free_shipping_speed === "all" ? "all" : "standard",
        discountPercent: Number(r.discount_percent),
        promoCode: r.promo_code ? String(r.promo_code) : void 0,
        enabled: Boolean(r.enabled),
        usageCount: Number(r.usage_count),
        revenueGenerated: Number(r.revenue_generated),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at)
      }));
      const mappedLabReports = rawLabReports.map((r) => ({
        id: String(r.id),
        laboratoryName: String(r.laboratory_name),
        reportNumber: String(r.report_number),
        testedBatchNumber: String(r.tested_batch_number),
        testDate: String(r.test_date),
        mappedProductIds: Array.isArray(r.mapped_product_ids) ? r.mapped_product_ids : [],
        testingMethodology: String(r.testing_methodology || r.accreditation || ""),
        verifiedStatus: r.verified_status === "Verified" || r.verified_status === "Pending Verification" ? r.verified_status : "Reference Sample",
        notes: String(r.notes || r.summary_note || ""),
        customDocumentUrl: r.custom_document_url ? String(r.custom_document_url) : void 0,
        originalFileName: r.original_file_name ? String(r.original_file_name) : void 0,
        originalMimeType: r.original_mime_type ? String(r.original_mime_type) : void 0,
        heavyMetals: Array.isArray(r.heavy_metals) ? r.heavy_metals : [],
        microbiological: Array.isArray(r.microbiological) ? r.microbiological : [],
        updatedAt: String(r.updated_at || r.test_date)
      }));
      const mappedCms = rawCms.map((r) => ({
        id: String(r.id),
        key: String(r.key),
        title: String(r.title),
        category: r.category === "faq" ? "faq" : "product",
        content: String(r.content),
        approvedByAdmin: Boolean(r.approved_by_admin),
        approvedAt: r.approved_at ? String(r.approved_at) : void 0,
        updatedAt: String(r.updated_at)
      }));
      return {
        empty: false,
        data: {
          products: mappedProducts,
          settings: rawSettings,
          coupons: mappedCoupons,
          promotions: mappedPromotions,
          labReports: mappedLabReports,
          cmsSections: mappedCms
        },
        dbMs
      };
    } catch (error) {
      logStructured("error", "cloud-sql", "load_public_bootstrap_failed", {
        durationMs: Date.now() - startedAt,
        code: getPgErrorCode(error) || "unknown"
      });
      throw error;
    }
  }
  mapUserRow(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role === "admin" ? "admin" : "customer",
      passwordHash: row.passwordHash,
      defaultAddress: row.defaultAddress ?? void 0,
      wishlistProductIds: Array.isArray(row.wishlistProductIds) ? row.wishlistProductIds : [],
      createdAt: row.createdAt
    };
  }
  mapProductRow(row) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      subtitle: row.subtitle,
      netQuantity: row.netQuantity,
      sku: row.sku,
      hsnCode: row.hsnCode,
      mrp: row.mrp,
      price: row.price,
      costPerUnit: row.costPerUnit,
      stock: row.stock,
      lowStockThreshold: row.lowStockThreshold,
      batchNumber: row.batchNumber,
      gstRatePercent: row.gstRatePercent,
      shortDescription: row.shortDescription,
      usageGuidance: row.usageGuidance,
      storageInstructions: row.storageInstructions,
      shippingNote: row.shippingNote,
      returnPolicy: row.returnPolicy,
      specifications: Array.isArray(row.specifications) ? row.specifications : [],
      galleryTypes: Array.isArray(row.galleryTypes) ? row.galleryTypes : [],
      customImages: Array.isArray(row.customImages) ? row.customImages : void 0,
      active: row.active
    };
  }
  mapOrderRow(row) {
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      userId: row.userId ?? void 0,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      shippingAddress: row.shippingAddress,
      deliveryInstructions: row.deliveryInstructions ?? void 0,
      items: Array.isArray(row.items) ? row.items : [],
      subtotal: row.subtotal,
      mrpTotal: row.mrpTotal,
      instantSavings: row.instantSavings,
      couponCode: row.couponCode ?? void 0,
      couponDiscount: row.couponDiscount,
      promotionId: row.promotionId ?? void 0,
      promotionTitle: row.promotionTitle ?? void 0,
      shippingFee: row.shippingFee,
      shippingSpeed: row.shippingSpeed === "express" ? "express" : "standard",
      codFee: row.codFee,
      taxableValue: row.taxableValue,
      gstAmount: row.gstAmount,
      totalAmount: row.totalAmount,
      gatewayFeeAmount: row.gatewayFeeAmount ?? void 0,
      actualShippingCost: row.actualShippingCost ?? void 0,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      razorpayOrderId: row.razorpayOrderId ?? void 0,
      razorpayPaymentId: row.razorpayPaymentId ?? void 0,
      paymentVerifiedAt: row.paymentVerifiedAt ?? void 0,
      status: row.status,
      courierPartner: row.courierName ?? void 0,
      trackingNumber: row.trackingNumber ?? void 0,
      trackingUrl: row.trackingUrl ?? void 0,
      estimatedDelivery: row.estimatedDelivery ?? void 0,
      dispatchedAt: row.dispatchedAt ?? void 0,
      deliveredAt: row.deliveredAt ?? void 0,
      refundAmount: row.refundAmount ?? void 0,
      refundReason: row.refundReason ?? void 0,
      refundRequestedAt: row.refundRequestedAt ?? void 0,
      timeline: Array.isArray(row.timeline) ? row.timeline : [],
      createdAt: row.createdAt
    };
  }
  mapPaymentIntentRow(row) {
    return {
      razorpayOrderId: row.razorpayOrderId,
      amountPaise: row.amountPaise,
      verified: row.verified,
      paymentId: row.paymentId ?? void 0,
      signatureVerified: row.signatureVerified,
      method: row.method,
      createdAt: row.createdAt
    };
  }
  /**
   * Targeted single-row upsert for a Razorpay payment intent.
   * Avoids rewriting all 12 tables during /api/payments/create-order and /api/payments/verify.
   */
  async upsertPaymentIntent(intent) {
    const startedAt = Date.now();
    try {
      await this.runWithRecovery(
        () => db.insert(paymentIntents).values({
          razorpayOrderId: intent.razorpayOrderId,
          amountPaise: intent.amountPaise,
          verified: intent.verified,
          paymentId: intent.paymentId ?? null,
          signatureVerified: intent.signatureVerified,
          method: intent.method,
          createdAt: intent.createdAt
        }).onConflictDoUpdate({
          target: paymentIntents.razorpayOrderId,
          set: {
            amountPaise: intent.amountPaise,
            verified: intent.verified,
            paymentId: intent.paymentId ?? null,
            signatureVerified: intent.signatureVerified,
            method: intent.method
          }
        })
      );
      logStructured("info", "cloud-sql", "upsert_payment_intent_success", {
        verified: intent.verified,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      logStructured("error", "cloud-sql", "upsert_payment_intent_failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Unable to save payment session right now. Please try again.", {
        code: "POSTGRES_PAYMENT_INTENT_WRITE_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  /**
   * Targeted single-row lookup for a Razorpay payment intent by razorpayOrderId.
   */
  async findPaymentIntent(razorpayOrderId) {
    const startedAt = Date.now();
    try {
      const rows = await this.runWithRecovery(
        () => db.select().from(paymentIntents).where(eq(paymentIntents.razorpayOrderId, razorpayOrderId)).limit(1)
      );
      logStructured("info", "cloud-sql", "find_payment_intent_success", {
        found: rows.length > 0,
        durationMs: Date.now() - startedAt
      });
      return rows[0] ? this.mapPaymentIntentRow(rows[0]) : null;
    } catch (error) {
      logStructured("error", "cloud-sql", "find_payment_intent_failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Unable to verify payment session right now. Please try again.", {
        code: "POSTGRES_PAYMENT_INTENT_READ_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  /**
   * Loads only the minimal tables required for checkout pricing, stock validation,
   * payment intent verification, order idempotency, and next order sequence numbering.
   * Skips users, all historical orders, lab_reports, cms_sections, expenses, inquiries, and notifications.
   */
  async loadCheckoutContext(params) {
    const startedAt = Date.now();
    try {
      const [
        productRows,
        couponRows,
        promotionRows,
        settingsRows,
        intentRows,
        existingOrderRows,
        seqResult
      ] = await this.runWithRecovery(
        () => Promise.all([
          db.select().from(products).orderBy(asc(products.sortOrder)),
          db.select().from(coupons).orderBy(asc(coupons.sortOrder)),
          db.select().from(promotions).orderBy(asc(promotions.sortOrder)),
          db.select().from(storeSettings).where(eq(storeSettings.id, "default")).limit(1),
          params?.razorpayOrderId ? db.select().from(paymentIntents).where(eq(paymentIntents.razorpayOrderId, params.razorpayOrderId)).limit(1) : Promise.resolve([]),
          params?.razorpayPaymentId || params?.razorpayOrderId ? db.select().from(orders).where(
            params.razorpayPaymentId && params.razorpayOrderId ? or(
              eq(orders.razorpayPaymentId, params.razorpayPaymentId),
              eq(orders.razorpayOrderId, params.razorpayOrderId)
            ) : params.razorpayPaymentId ? eq(orders.razorpayPaymentId, params.razorpayPaymentId) : eq(orders.razorpayOrderId, params.razorpayOrderId)
          ).limit(1) : Promise.resolve([]),
          params?.includeOrderSequence ? db.execute(
            sql`SELECT
                  GREATEST(
                    COUNT(*)::int,
                    COALESCE(
                      MAX(
                        CASE
                          WHEN order_number ~ '^HIM-2026-[0-9]+$'
                          THEN SUBSTRING(order_number FROM '^HIM-2026-([0-9]+)$')::int
                          ELSE 0
                        END
                      ),
                      0
                    )
                  ) AS max_seq
                FROM orders`
          ) : Promise.resolve(null)
        ])
      );
      const rawSeqRow = seqResult && Array.isArray(seqResult.rows) ? seqResult.rows[0] ?? null : null;
      const maxOrderSeq = Number(rawSeqRow?.max_seq ?? 0) || 0;
      const mappedProducts = productRows.map((row) => this.mapProductRow(row));
      const mappedCoupons = couponRows.map((row) => ({
        code: row.code,
        discountType: row.type === "flat" ? "flat" : "percent",
        value: row.value,
        minOrderAmount: row.minOrderValue,
        active: row.active,
        description: row.description
      }));
      const mappedPromotions = promotionRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        bannerHeadline: row.bannerHeadline,
        bannerSubtext: row.bannerSubtext,
        bannerTheme: row.bannerTheme,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        freeShipping: row.freeShipping,
        freeShippingSpeed: row.freeShippingSpeed === "all" ? "all" : "standard",
        discountPercent: row.discountPercent,
        promoCode: row.promoCode ?? void 0,
        enabled: row.enabled,
        usageCount: row.usageCount,
        revenueGenerated: row.revenueGenerated,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }));
      logStructured("info", "cloud-sql", "load_checkout_context_success", {
        productCount: mappedProducts.length,
        hasIntent: intentRows.length > 0,
        hasExistingOrder: existingOrderRows.length > 0,
        durationMs: Date.now() - startedAt
      });
      return {
        empty: mappedProducts.length === 0 && settingsRows.length === 0,
        products: mappedProducts,
        coupons: mappedCoupons,
        promotions: mappedPromotions,
        settings: settingsRows[0]?.payload ?? null,
        paymentIntent: intentRows[0] ? this.mapPaymentIntentRow(intentRows[0]) : null,
        existingOrderByPayment: existingOrderRows[0] ? this.mapOrderRow(existingOrderRows[0]) : null,
        maxOrderSeq
      };
    } catch (error) {
      logStructured("error", "cloud-sql", "load_checkout_context_failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Database read failed during checkout. Please try again shortly.", {
        code: "POSTGRES_CHECKOUT_READ_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  async findUserByEmail(email) {
    try {
      const normalized = email.trim().toLowerCase();
      const rows = await this.runWithRecovery(
        () => db.select().from(users).where(eq(users.email, normalized)).limit(1)
      );
      return rows[0] ? this.mapUserRow(rows[0]) : null;
    } catch (error) {
      logStructured("error", "cloud-sql", "find_user_by_email_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Database read failed. Please try again shortly.", {
        code: "POSTGRES_READ_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  async findUserById(id) {
    try {
      const rows = await this.runWithRecovery(
        () => db.select().from(users).where(eq(users.id, id)).limit(1)
      );
      return rows[0] ? this.mapUserRow(rows[0]) : null;
    } catch (error) {
      logStructured("error", "cloud-sql", "find_user_by_id_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Database read failed. Please try again shortly.", {
        code: "POSTGRES_READ_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  /**
   * Fast, atomic single-row user save (~20ms) that avoids full 12-table rewrites and
   * eliminates unique email/uid constraint race conditions during Google & Email sign-in.
   */
  async upsertUser(user, uid) {
    const startedAt = Date.now();
    const normalizedEmail = user.email.trim().toLowerCase();
    try {
      const rows = await this.runWithRecovery(
        () => db.insert(users).values({
          id: user.id,
          ...uid ? { uid } : {},
          name: user.name,
          email: normalizedEmail,
          phone: user.phone ?? "",
          role: user.role,
          passwordHash: user.passwordHash,
          defaultAddress: user.defaultAddress ?? null,
          wishlistProductIds: user.wishlistProductIds ?? [],
          createdAt: user.createdAt,
          updatedAt: /* @__PURE__ */ new Date()
        }).onConflictDoUpdate({
          target: users.email,
          set: {
            ...uid ? { uid } : {},
            name: user.name,
            phone: user.phone ?? "",
            role: user.role,
            defaultAddress: user.defaultAddress ?? null,
            wishlistProductIds: user.wishlistProductIds ?? [],
            updatedAt: /* @__PURE__ */ new Date()
          }
        }).returning()
      );
      logStructured("info", "cloud-sql", "upsert_user_success", {
        durationMs: Date.now() - startedAt
      });
      return rows[0] ? this.mapUserRow(rows[0]) : { ...user, email: normalizedEmail };
    } catch (error) {
      logStructured("error", "cloud-sql", "upsert_user_failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Database save failed. Please try again shortly.", {
        code: "POSTGRES_USER_WRITE_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  /**
   * Atomically inserts a new email/password customer; returns null if the email already exists.
   */
  async createUserIfNotExists(user) {
    const startedAt = Date.now();
    const normalizedEmail = user.email.trim().toLowerCase();
    try {
      const rows = await this.runWithRecovery(
        () => db.insert(users).values({
          id: user.id,
          name: user.name,
          email: normalizedEmail,
          phone: user.phone ?? "",
          role: user.role,
          passwordHash: user.passwordHash,
          defaultAddress: user.defaultAddress ?? null,
          wishlistProductIds: user.wishlistProductIds ?? [],
          createdAt: user.createdAt,
          updatedAt: /* @__PURE__ */ new Date()
        }).onConflictDoNothing({ target: users.email }).returning()
      );
      logStructured("info", "cloud-sql", "create_user_attempt", {
        durationMs: Date.now() - startedAt,
        created: rows.length > 0
      });
      return rows[0] ? this.mapUserRow(rows[0]) : null;
    } catch (error) {
      logStructured("error", "cloud-sql", "create_user_failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Database save failed. Please try again shortly.", {
        code: "POSTGRES_USER_WRITE_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  async loadState(getFallbackSeed) {
    const startedAt = Date.now();
    const resolveFallbackSeed = () => typeof getFallbackSeed === "function" ? getFallbackSeed() : getFallbackSeed;
    try {
      const [
        userRows,
        productRows,
        orderRows,
        couponRows,
        promotionRows,
        labReportRows,
        cmsRows,
        expenseRows,
        inquiryRows,
        notifRows,
        intentRows,
        settingsRows
      ] = await this.runWithRecovery(
        () => Promise.all([
          db.select().from(users).orderBy(asc(users.createdAt)),
          db.select().from(products).orderBy(asc(products.sortOrder)),
          db.select().from(orders).orderBy(asc(orders.sortOrder), desc(orders.createdAt)),
          db.select().from(coupons).orderBy(asc(coupons.sortOrder)),
          db.select().from(promotions).orderBy(asc(promotions.sortOrder)),
          db.select().from(labReports).orderBy(asc(labReports.sortOrder)),
          db.select().from(cmsSections).orderBy(asc(cmsSections.sortOrder)),
          db.select().from(expenses).orderBy(asc(expenses.sortOrder)),
          db.select().from(inquiries).orderBy(asc(inquiries.sortOrder)),
          db.select().from(adminNotifications).orderBy(asc(adminNotifications.sortOrder), desc(adminNotifications.createdAt)),
          db.select().from(paymentIntents),
          db.select().from(storeSettings).where(eq(storeSettings.id, "default")).limit(1)
        ])
      );
      if (isTableEmpty({
        userCount: userRows.length,
        productCount: productRows.length,
        settingsCount: settingsRows.length
      })) {
        return { empty: true, state: resolveFallbackSeed(), dbMs: Date.now() - startedAt };
      }
      const mappedUsers = userRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role === "admin" ? "admin" : "customer",
        passwordHash: row.passwordHash,
        defaultAddress: row.defaultAddress ?? void 0,
        wishlistProductIds: Array.isArray(row.wishlistProductIds) ? row.wishlistProductIds : [],
        createdAt: row.createdAt
      }));
      const mappedProducts = productRows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        subtitle: row.subtitle,
        netQuantity: row.netQuantity,
        sku: row.sku,
        hsnCode: row.hsnCode,
        mrp: row.mrp,
        price: row.price,
        costPerUnit: row.costPerUnit,
        stock: row.stock,
        lowStockThreshold: row.lowStockThreshold,
        batchNumber: row.batchNumber,
        gstRatePercent: row.gstRatePercent,
        shortDescription: row.shortDescription,
        usageGuidance: row.usageGuidance,
        storageInstructions: row.storageInstructions,
        shippingNote: row.shippingNote,
        returnPolicy: row.returnPolicy,
        specifications: Array.isArray(row.specifications) ? row.specifications : [],
        galleryTypes: Array.isArray(row.galleryTypes) ? row.galleryTypes : [],
        customImages: Array.isArray(row.customImages) ? row.customImages : void 0,
        active: row.active
      }));
      const mappedOrders = orderRows.map((row) => ({
        id: row.id,
        orderNumber: row.orderNumber,
        userId: row.userId ?? void 0,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        customerPhone: row.customerPhone,
        shippingAddress: row.shippingAddress,
        deliveryInstructions: row.deliveryInstructions ?? void 0,
        items: Array.isArray(row.items) ? row.items : [],
        subtotal: row.subtotal,
        mrpTotal: row.mrpTotal,
        instantSavings: row.instantSavings,
        couponCode: row.couponCode ?? void 0,
        couponDiscount: row.couponDiscount,
        promotionId: row.promotionId ?? void 0,
        promotionTitle: row.promotionTitle ?? void 0,
        shippingFee: row.shippingFee,
        shippingSpeed: row.shippingSpeed === "express" ? "express" : "standard",
        codFee: row.codFee,
        taxableValue: row.taxableValue,
        gstAmount: row.gstAmount,
        totalAmount: row.totalAmount,
        gatewayFeeAmount: row.gatewayFeeAmount ?? void 0,
        actualShippingCost: row.actualShippingCost ?? void 0,
        paymentMethod: row.paymentMethod,
        paymentStatus: row.paymentStatus,
        razorpayOrderId: row.razorpayOrderId ?? void 0,
        razorpayPaymentId: row.razorpayPaymentId ?? void 0,
        paymentVerifiedAt: row.paymentVerifiedAt ?? void 0,
        status: row.status,
        courierPartner: row.courierName ?? void 0,
        trackingNumber: row.trackingNumber ?? void 0,
        trackingUrl: row.trackingUrl ?? void 0,
        estimatedDelivery: row.estimatedDelivery ?? void 0,
        dispatchedAt: row.dispatchedAt ?? void 0,
        deliveredAt: row.deliveredAt ?? void 0,
        refundAmount: row.refundAmount ?? void 0,
        refundReason: row.refundReason ?? void 0,
        refundRequestedAt: row.refundRequestedAt ?? void 0,
        timeline: Array.isArray(row.timeline) ? row.timeline : [],
        createdAt: row.createdAt
      }));
      const mappedCoupons = couponRows.map((row) => ({
        code: row.code,
        discountType: row.type === "flat" ? "flat" : "percent",
        value: row.value,
        minOrderAmount: row.minOrderValue,
        active: row.active,
        description: row.description
      }));
      const mappedPromotions = promotionRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        bannerHeadline: row.bannerHeadline,
        bannerSubtext: row.bannerSubtext,
        bannerTheme: row.bannerTheme,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        freeShipping: row.freeShipping,
        freeShippingSpeed: row.freeShippingSpeed === "all" ? "all" : "standard",
        discountPercent: row.discountPercent,
        promoCode: row.promoCode ?? void 0,
        enabled: row.enabled,
        usageCount: row.usageCount,
        revenueGenerated: row.revenueGenerated,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }));
      const mappedLabReports = labReportRows.map((row) => ({
        id: row.id,
        laboratoryName: row.laboratoryName,
        reportNumber: row.reportNumber,
        testedBatchNumber: row.testedBatchNumber,
        testDate: row.testDate,
        mappedProductIds: Array.isArray(row.mappedProductIds) ? row.mappedProductIds : [],
        testingMethodology: row.testingMethodology || row.accreditation || "",
        verifiedStatus: row.verifiedStatus === "Verified" || row.verifiedStatus === "Pending Verification" ? row.verifiedStatus : "Reference Sample",
        notes: row.notes || row.summaryNote || "",
        customDocumentUrl: row.customDocumentUrl ?? void 0,
        originalFileName: row.originalFileName ?? void 0,
        originalMimeType: row.originalMimeType ?? void 0,
        heavyMetals: Array.isArray(row.heavyMetals) ? row.heavyMetals : [],
        microbiological: Array.isArray(row.microbiological) ? row.microbiological : [],
        updatedAt: row.updatedAt || row.testDate
      }));
      const mappedCms = cmsRows.map((row) => ({
        id: row.id,
        key: row.key,
        title: row.title,
        category: row.category === "faq" ? "faq" : "product",
        content: row.content,
        approvedByAdmin: row.approvedByAdmin,
        approvedAt: row.approvedAt ?? void 0,
        updatedAt: row.updatedAt
      }));
      const mappedExpenses = expenseRows.map((row) => ({
        id: row.id,
        date: row.date,
        category: row.category,
        description: row.description,
        amount: row.amount
      }));
      const mappedInquiries = inquiryRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone || void 0,
        subject: row.subject,
        message: row.message,
        status: row.status === "Responded" ? "Responded" : "New",
        replyMessage: row.replyMessage ?? void 0,
        repliedAt: row.repliedAt ?? void 0,
        repliedVia: Array.isArray(row.repliedVia) ? row.repliedVia : void 0,
        emailDeliveryStatus: row.emailDeliveryStatus === "sent" || row.emailDeliveryStatus === "mailto_ready" ? row.emailDeliveryStatus : void 0,
        createdAt: row.createdAt
      }));
      const mappedNotifs = notifRows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        orderId: row.orderId ?? void 0,
        orderNumber: row.orderNumber ?? void 0,
        customerName: row.customerName ?? void 0,
        amount: row.amount ?? void 0,
        read: row.read,
        emailNotifiedTo: row.emailNotifiedTo ?? void 0,
        createdAt: row.createdAt
      }));
      const mappedIntents = {};
      for (const row of intentRows) {
        mappedIntents[row.razorpayOrderId] = {
          razorpayOrderId: row.razorpayOrderId,
          amountPaise: row.amountPaise,
          verified: row.verified,
          paymentId: row.paymentId ?? void 0,
          signatureVerified: row.signatureVerified,
          method: row.method,
          createdAt: row.createdAt
        };
      }
      return {
        empty: false,
        state: {
          users: mappedUsers,
          products: mappedProducts,
          settings: settingsRows[0]?.payload ?? resolveFallbackSeed().settings,
          coupons: mappedCoupons,
          promotions: mappedPromotions,
          orders: mappedOrders,
          labReports: mappedLabReports,
          cmsSections: mappedCms,
          expenses: mappedExpenses,
          inquiries: mappedInquiries,
          adminNotifications: mappedNotifs,
          paymentIntents: mappedIntents
        },
        dbMs: Date.now() - startedAt
      };
    } catch (error) {
      logStructured("error", "cloud-sql", "load_state_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Database read failed. Please try again shortly.", {
        code: "POSTGRES_READ_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  /**
   * Atomically verifies & decrements product stock and creates the order inside a single PostgreSQL ACID transaction.
   * Guarantees zero overselling even when 500 concurrent users check out at the exact same millisecond.
   */
  async transactCreateOrderAndDecrementStock(params) {
    const startedAt = Date.now();
    try {
      const txResult = await this.runWithRecovery(
        () => db.transaction(async (tx) => {
          const o = params.order;
          if (o.paymentMethod !== "COD" && (o.razorpayPaymentId || o.razorpayOrderId)) {
            const dupCondition = o.razorpayPaymentId && o.razorpayOrderId ? or(
              eq(orders.razorpayPaymentId, o.razorpayPaymentId),
              eq(orders.razorpayOrderId, o.razorpayOrderId)
            ) : o.razorpayPaymentId ? eq(orders.razorpayPaymentId, o.razorpayPaymentId) : eq(orders.razorpayOrderId, o.razorpayOrderId);
            const existingRows = await tx.select().from(orders).where(dupCondition).limit(1);
            if (existingRows[0]) {
              return {
                existingOrder: this.mapOrderRow(existingRows[0]),
                updatedProducts: []
              };
            }
          }
          const updatedProducts = [];
          for (const dec of params.stockDecrements) {
            const updated = await tx.update(products).set({
              stock: sql`${products.stock} - ${dec.quantity}`,
              updatedAt: /* @__PURE__ */ new Date()
            }).where(and(eq(products.id, dec.productId), gte(products.stock, dec.quantity))).returning({ id: products.id, stock: products.stock });
            if (updated.length === 0) {
              throw new StorePersistenceError(
                "Order could not be completed because one or more items just went out of stock. Please review your cart and try again.",
                {
                  code: "ORDER_STOCK_CONFLICT",
                  statusCode: 409,
                  retryable: false
                }
              );
            }
            updatedProducts.push(updated[0]);
          }
          let safeUserId = o.userId ?? null;
          if (safeUserId) {
            const foundUser = await tx.select({ id: users.id }).from(users).where(eq(users.id, safeUserId)).limit(1);
            if (foundUser.length === 0) {
              safeUserId = null;
            }
          }
          await tx.insert(orders).values({
            id: o.id,
            sortOrder: 0,
            orderNumber: o.orderNumber,
            userId: safeUserId,
            customerName: o.customerName,
            customerEmail: o.customerEmail,
            customerPhone: o.customerPhone,
            shippingAddress: o.shippingAddress,
            deliveryInstructions: o.deliveryInstructions ?? null,
            items: o.items,
            subtotal: o.subtotal,
            mrpTotal: o.mrpTotal,
            instantSavings: o.instantSavings,
            couponCode: o.couponCode ?? null,
            couponDiscount: o.couponDiscount,
            promotionId: o.promotionId ?? null,
            promotionTitle: o.promotionTitle ?? null,
            shippingFee: o.shippingFee,
            shippingSpeed: o.shippingSpeed,
            codFee: o.codFee,
            taxableValue: o.taxableValue,
            gstAmount: o.gstAmount,
            totalAmount: o.totalAmount,
            gatewayFeeAmount: o.gatewayFeeAmount ?? null,
            actualShippingCost: o.actualShippingCost ?? null,
            paymentMethod: o.paymentMethod,
            paymentStatus: o.paymentStatus,
            razorpayOrderId: o.razorpayOrderId ?? null,
            razorpayPaymentId: o.razorpayPaymentId ?? null,
            paymentVerifiedAt: o.paymentVerifiedAt ?? null,
            status: o.status,
            courierName: o.courierPartner ?? null,
            trackingNumber: o.trackingNumber ?? null,
            trackingUrl: o.trackingUrl ?? null,
            estimatedDelivery: o.estimatedDelivery ?? null,
            dispatchedAt: o.dispatchedAt ?? null,
            deliveredAt: o.deliveredAt ?? null,
            refundAmount: o.refundAmount ?? null,
            refundReason: o.refundReason ?? null,
            refundRequestedAt: o.refundRequestedAt ?? null,
            timeline: o.timeline,
            createdAt: o.createdAt
          }).onConflictDoNothing({ target: orders.id });
          if (params.promotionUpdate) {
            await tx.update(promotions).set({
              usageCount: sql`${promotions.usageCount} + 1`,
              revenueGenerated: sql`${promotions.revenueGenerated} + ${params.promotionUpdate.revenueDelta}`,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            }).where(eq(promotions.id, params.promotionUpdate.promotionId));
          }
          if (params.adminNotification) {
            const n = params.adminNotification;
            await tx.insert(adminNotifications).values({
              id: n.id,
              sortOrder: 0,
              type: n.type,
              title: n.title,
              message: n.message,
              orderId: n.orderId ?? null,
              orderNumber: n.orderNumber ?? null,
              customerName: n.customerName ?? null,
              amount: n.amount ?? null,
              read: n.read,
              emailNotifiedTo: n.emailNotifiedTo ?? null,
              createdAt: n.createdAt
            }).onConflictDoNothing({ target: adminNotifications.id });
          }
          if (params.userDefaultAddressUpdate && safeUserId) {
            await tx.update(users).set({
              defaultAddress: params.userDefaultAddressUpdate.address,
              updatedAt: /* @__PURE__ */ new Date()
            }).where(eq(users.id, safeUserId));
          }
          return { existingOrder: void 0, updatedProducts };
        })
      );
      logStructured("info", "cloud-sql", "transact_order_success", {
        orderId: params.order.id,
        orderNumber: params.order.orderNumber,
        idempotent: Boolean(txResult.existingOrder),
        durationMs: Date.now() - startedAt
      });
      return txResult;
    } catch (error) {
      if (error instanceof StorePersistenceError) {
        throw error;
      }
      const pgCode = getPgErrorCode(error);
      logStructured("error", "cloud-sql", "transact_order_failed", {
        orderId: params.order.id,
        pgCode: pgCode || void 0,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Unable to confirm your order right now. Please try again.", {
        code: pgCode === "23505" ? "ORDER_NUMBER_CONFLICT" : "POSTGRES_TX_FAILED",
        statusCode: pgCode === "23505" ? 409 : 503,
        retryable: true
      });
    }
  }
  /**
   * Synchronizes all entities transactionally into PostgreSQL using Drizzle type-safe upserts & targeted deletions.
   */
  async persistState(state) {
    const startedAt = Date.now();
    try {
      await this.runWithRecovery(
        () => db.transaction(async (tx) => {
          await tx.insert(storeSettings).values({
            id: "default",
            payload: state.settings,
            updatedAt: /* @__PURE__ */ new Date()
          }).onConflictDoUpdate({
            target: storeSettings.id,
            set: {
              payload: state.settings,
              updatedAt: /* @__PURE__ */ new Date()
            }
          });
          const userIds = [];
          for (const u of state.users) {
            const normalizedEmail = u.email.trim().toLowerCase();
            const savedRows = await tx.insert(users).values({
              id: u.id,
              name: u.name,
              email: normalizedEmail,
              phone: u.phone,
              role: u.role,
              passwordHash: u.passwordHash,
              defaultAddress: u.defaultAddress ?? null,
              wishlistProductIds: u.wishlistProductIds ?? [],
              createdAt: u.createdAt,
              updatedAt: /* @__PURE__ */ new Date()
            }).onConflictDoUpdate({
              target: users.email,
              set: {
                name: u.name,
                phone: u.phone,
                role: u.role,
                defaultAddress: u.defaultAddress ?? null,
                wishlistProductIds: u.wishlistProductIds ?? [],
                updatedAt: /* @__PURE__ */ new Date()
              }
            }).returning({ id: users.id });
            userIds.push(savedRows[0]?.id ?? u.id);
          }
          const productIds = [];
          for (let idx = 0; idx < state.products.length; idx += 1) {
            const p = state.products[idx];
            productIds.push(p.id);
            await tx.insert(products).values({
              id: p.id,
              sortOrder: idx,
              slug: p.slug,
              name: p.name,
              subtitle: p.subtitle,
              netQuantity: p.netQuantity,
              sku: p.sku,
              hsnCode: p.hsnCode,
              mrp: p.mrp,
              price: p.price,
              costPerUnit: p.costPerUnit,
              stock: p.stock,
              lowStockThreshold: p.lowStockThreshold,
              batchNumber: p.batchNumber,
              gstRatePercent: p.gstRatePercent,
              shortDescription: p.shortDescription,
              usageGuidance: p.usageGuidance,
              storageInstructions: p.storageInstructions,
              shippingNote: p.shippingNote,
              returnPolicy: p.returnPolicy,
              specifications: p.specifications ?? [],
              galleryTypes: p.galleryTypes ?? [],
              customImages: p.customImages ?? null,
              active: p.active,
              updatedAt: /* @__PURE__ */ new Date()
            }).onConflictDoUpdate({
              target: products.id,
              set: {
                sortOrder: idx,
                slug: p.slug,
                name: p.name,
                subtitle: p.subtitle,
                netQuantity: p.netQuantity,
                sku: p.sku,
                hsnCode: p.hsnCode,
                mrp: p.mrp,
                price: p.price,
                costPerUnit: p.costPerUnit,
                stock: p.stock,
                lowStockThreshold: p.lowStockThreshold,
                batchNumber: p.batchNumber,
                gstRatePercent: p.gstRatePercent,
                shortDescription: p.shortDescription,
                usageGuidance: p.usageGuidance,
                storageInstructions: p.storageInstructions,
                shippingNote: p.shippingNote,
                returnPolicy: p.returnPolicy,
                specifications: p.specifications ?? [],
                galleryTypes: p.galleryTypes ?? [],
                customImages: p.customImages ?? null,
                active: p.active,
                updatedAt: /* @__PURE__ */ new Date()
              }
            });
          }
          if (productIds.length > 0) {
            await tx.delete(products).where(notInArray(products.id, productIds));
          } else {
            await tx.delete(products);
          }
          const validUserIdSet = new Set(userIds);
          const orderIds = [];
          for (let idx = 0; idx < state.orders.length; idx += 1) {
            const o = state.orders[idx];
            orderIds.push(o.id);
            const safeUserId = o.userId && validUserIdSet.has(o.userId) ? o.userId : null;
            await tx.insert(orders).values({
              id: o.id,
              sortOrder: idx,
              orderNumber: o.orderNumber,
              userId: safeUserId,
              customerName: o.customerName,
              customerEmail: o.customerEmail,
              customerPhone: o.customerPhone,
              shippingAddress: o.shippingAddress,
              deliveryInstructions: o.deliveryInstructions ?? null,
              items: o.items,
              subtotal: o.subtotal,
              mrpTotal: o.mrpTotal,
              instantSavings: o.instantSavings,
              couponCode: o.couponCode ?? null,
              couponDiscount: o.couponDiscount,
              promotionId: o.promotionId ?? null,
              promotionTitle: o.promotionTitle ?? null,
              shippingFee: o.shippingFee,
              shippingSpeed: o.shippingSpeed,
              codFee: o.codFee,
              taxableValue: o.taxableValue,
              gstAmount: o.gstAmount,
              totalAmount: o.totalAmount,
              gatewayFeeAmount: o.gatewayFeeAmount ?? null,
              actualShippingCost: o.actualShippingCost ?? null,
              paymentMethod: o.paymentMethod,
              paymentStatus: o.paymentStatus,
              razorpayOrderId: o.razorpayOrderId ?? null,
              razorpayPaymentId: o.razorpayPaymentId ?? null,
              paymentVerifiedAt: o.paymentVerifiedAt ?? null,
              status: o.status,
              courierName: o.courierPartner ?? null,
              trackingNumber: o.trackingNumber ?? null,
              trackingUrl: o.trackingUrl ?? null,
              estimatedDelivery: o.estimatedDelivery ?? null,
              dispatchedAt: o.dispatchedAt ?? null,
              deliveredAt: o.deliveredAt ?? null,
              refundAmount: o.refundAmount ?? null,
              refundReason: o.refundReason ?? null,
              refundRequestedAt: o.refundRequestedAt ?? null,
              timeline: o.timeline ?? [],
              createdAt: o.createdAt
            }).onConflictDoUpdate({
              target: orders.id,
              set: {
                sortOrder: idx,
                userId: safeUserId,
                customerName: o.customerName,
                customerEmail: o.customerEmail,
                customerPhone: o.customerPhone,
                shippingAddress: o.shippingAddress,
                deliveryInstructions: o.deliveryInstructions ?? null,
                items: o.items,
                subtotal: o.subtotal,
                mrpTotal: o.mrpTotal,
                instantSavings: o.instantSavings,
                couponCode: o.couponCode ?? null,
                couponDiscount: o.couponDiscount,
                promotionId: o.promotionId ?? null,
                promotionTitle: o.promotionTitle ?? null,
                shippingFee: o.shippingFee,
                shippingSpeed: o.shippingSpeed,
                codFee: o.codFee,
                taxableValue: o.taxableValue,
                gstAmount: o.gstAmount,
                totalAmount: o.totalAmount,
                gatewayFeeAmount: o.gatewayFeeAmount ?? null,
                actualShippingCost: o.actualShippingCost ?? null,
                paymentMethod: o.paymentMethod,
                paymentStatus: o.paymentStatus,
                razorpayOrderId: o.razorpayOrderId ?? null,
                razorpayPaymentId: o.razorpayPaymentId ?? null,
                paymentVerifiedAt: o.paymentVerifiedAt ?? null,
                status: o.status,
                courierName: o.courierPartner ?? null,
                trackingNumber: o.trackingNumber ?? null,
                trackingUrl: o.trackingUrl ?? null,
                estimatedDelivery: o.estimatedDelivery ?? null,
                dispatchedAt: o.dispatchedAt ?? null,
                deliveredAt: o.deliveredAt ?? null,
                refundAmount: o.refundAmount ?? null,
                refundReason: o.refundReason ?? null,
                refundRequestedAt: o.refundRequestedAt ?? null,
                timeline: o.timeline ?? []
              }
            });
          }
          if (orderIds.length > 0) {
            await tx.delete(orders).where(notInArray(orders.id, orderIds));
          } else {
            await tx.delete(orders);
          }
          const couponIds = [];
          for (let idx = 0; idx < state.coupons.length; idx += 1) {
            const c = state.coupons[idx];
            couponIds.push(c.code);
            await tx.insert(coupons).values({
              id: c.code,
              sortOrder: idx,
              code: c.code,
              type: c.discountType,
              value: c.value,
              minOrderValue: c.minOrderAmount,
              maxDiscount: null,
              active: c.active,
              description: c.description
            }).onConflictDoUpdate({
              target: coupons.id,
              set: {
                sortOrder: idx,
                code: c.code,
                type: c.discountType,
                value: c.value,
                minOrderValue: c.minOrderAmount,
                active: c.active,
                description: c.description
              }
            });
          }
          if (couponIds.length > 0) {
            await tx.delete(coupons).where(notInArray(coupons.id, couponIds));
          } else {
            await tx.delete(coupons);
          }
          const promoIds = [];
          for (let idx = 0; idx < state.promotions.length; idx += 1) {
            const pr = state.promotions[idx];
            promoIds.push(pr.id);
            await tx.insert(promotions).values({
              id: pr.id,
              sortOrder: idx,
              title: pr.title,
              description: pr.description,
              bannerHeadline: pr.bannerHeadline,
              bannerSubtext: pr.bannerSubtext,
              bannerTheme: pr.bannerTheme,
              startsAt: pr.startsAt,
              endsAt: pr.endsAt,
              freeShipping: pr.freeShipping,
              freeShippingSpeed: pr.freeShippingSpeed,
              discountPercent: pr.discountPercent,
              promoCode: pr.promoCode ?? null,
              enabled: pr.enabled,
              usageCount: pr.usageCount,
              revenueGenerated: pr.revenueGenerated,
              createdAt: pr.createdAt,
              updatedAt: pr.updatedAt
            }).onConflictDoUpdate({
              target: promotions.id,
              set: {
                sortOrder: idx,
                title: pr.title,
                description: pr.description,
                bannerHeadline: pr.bannerHeadline,
                bannerSubtext: pr.bannerSubtext,
                bannerTheme: pr.bannerTheme,
                startsAt: pr.startsAt,
                endsAt: pr.endsAt,
                freeShipping: pr.freeShipping,
                freeShippingSpeed: pr.freeShippingSpeed,
                discountPercent: pr.discountPercent,
                promoCode: pr.promoCode ?? null,
                enabled: pr.enabled,
                usageCount: pr.usageCount,
                revenueGenerated: pr.revenueGenerated,
                updatedAt: pr.updatedAt
              }
            });
          }
          if (promoIds.length > 0) {
            await tx.delete(promotions).where(notInArray(promotions.id, promoIds));
          } else {
            await tx.delete(promotions);
          }
          const labIds = [];
          for (let idx = 0; idx < state.labReports.length; idx += 1) {
            const r = state.labReports[idx];
            labIds.push(r.id);
            await tx.insert(labReports).values({
              id: r.id,
              sortOrder: idx,
              batchNumber: r.testedBatchNumber,
              testedBatchNumber: r.testedBatchNumber,
              reportNumber: r.reportNumber,
              laboratoryName: r.laboratoryName,
              accreditation: r.testingMethodology,
              testDate: r.testDate,
              expiryDate: "",
              sampleDescription: "",
              fulvicAcidPercent: "",
              verdict: r.verifiedStatus,
              summaryNote: r.notes,
              mappedProductIds: r.mappedProductIds ?? [],
              testingMethodology: r.testingMethodology,
              verifiedStatus: r.verifiedStatus,
              notes: r.notes,
              updatedAt: r.updatedAt,
              customDocumentUrl: r.customDocumentUrl ?? null,
              originalFileName: r.originalFileName ?? null,
              originalMimeType: r.originalMimeType ?? null,
              heavyMetals: r.heavyMetals ?? [],
              microbiological: r.microbiological ?? []
            }).onConflictDoUpdate({
              target: labReports.id,
              set: {
                sortOrder: idx,
                batchNumber: r.testedBatchNumber,
                testedBatchNumber: r.testedBatchNumber,
                reportNumber: r.reportNumber,
                laboratoryName: r.laboratoryName,
                accreditation: r.testingMethodology,
                testDate: r.testDate,
                verdict: r.verifiedStatus,
                summaryNote: r.notes,
                mappedProductIds: r.mappedProductIds ?? [],
                testingMethodology: r.testingMethodology,
                verifiedStatus: r.verifiedStatus,
                notes: r.notes,
                updatedAt: r.updatedAt,
                customDocumentUrl: r.customDocumentUrl ?? null,
                originalFileName: r.originalFileName ?? null,
                originalMimeType: r.originalMimeType ?? null,
                heavyMetals: r.heavyMetals ?? [],
                microbiological: r.microbiological ?? []
              }
            });
          }
          if (labIds.length > 0) {
            await tx.delete(labReports).where(notInArray(labReports.id, labIds));
          } else {
            await tx.delete(labReports);
          }
          const cmsIds = [];
          for (let idx = 0; idx < state.cmsSections.length; idx += 1) {
            const s = state.cmsSections[idx];
            cmsIds.push(s.id);
            await tx.insert(cmsSections).values({
              id: s.id,
              sortOrder: idx,
              key: s.key,
              title: s.title,
              category: s.category,
              content: s.content,
              approvedByAdmin: s.approvedByAdmin,
              approvedAt: s.approvedAt ?? null,
              updatedAt: s.updatedAt
            }).onConflictDoUpdate({
              target: cmsSections.id,
              set: {
                sortOrder: idx,
                key: s.key,
                title: s.title,
                category: s.category,
                content: s.content,
                approvedByAdmin: s.approvedByAdmin,
                approvedAt: s.approvedAt ?? null,
                updatedAt: s.updatedAt
              }
            });
          }
          if (cmsIds.length > 0) {
            await tx.delete(cmsSections).where(notInArray(cmsSections.id, cmsIds));
          } else {
            await tx.delete(cmsSections);
          }
          const expenseIds = [];
          for (let idx = 0; idx < state.expenses.length; idx += 1) {
            const e = state.expenses[idx];
            expenseIds.push(e.id);
            await tx.insert(expenses).values({
              id: e.id,
              sortOrder: idx,
              date: e.date,
              category: e.category,
              description: e.description,
              amount: e.amount
            }).onConflictDoUpdate({
              target: expenses.id,
              set: {
                sortOrder: idx,
                date: e.date,
                category: e.category,
                description: e.description,
                amount: e.amount
              }
            });
          }
          if (expenseIds.length > 0) {
            await tx.delete(expenses).where(notInArray(expenses.id, expenseIds));
          } else {
            await tx.delete(expenses);
          }
          const inquiryIds = [];
          for (let idx = 0; idx < state.inquiries.length; idx += 1) {
            const inq = state.inquiries[idx];
            inquiryIds.push(inq.id);
            await tx.insert(inquiries).values({
              id: inq.id,
              sortOrder: idx,
              name: inq.name,
              email: inq.email,
              phone: inq.phone ?? "",
              subject: inq.subject,
              message: inq.message,
              status: inq.status,
              replyMessage: inq.replyMessage ?? null,
              repliedAt: inq.repliedAt ?? null,
              repliedVia: inq.repliedVia ?? null,
              emailDeliveryStatus: inq.emailDeliveryStatus ?? null,
              createdAt: inq.createdAt
            }).onConflictDoUpdate({
              target: inquiries.id,
              set: {
                sortOrder: idx,
                name: inq.name,
                email: inq.email,
                phone: inq.phone ?? "",
                subject: inq.subject,
                message: inq.message,
                status: inq.status,
                replyMessage: inq.replyMessage ?? null,
                repliedAt: inq.repliedAt ?? null,
                repliedVia: inq.repliedVia ?? null,
                emailDeliveryStatus: inq.emailDeliveryStatus ?? null
              }
            });
          }
          if (inquiryIds.length > 0) {
            await tx.delete(inquiries).where(notInArray(inquiries.id, inquiryIds));
          } else {
            await tx.delete(inquiries);
          }
          const notifIds = [];
          for (let idx = 0; idx < state.adminNotifications.length; idx += 1) {
            const n = state.adminNotifications[idx];
            notifIds.push(n.id);
            await tx.insert(adminNotifications).values({
              id: n.id,
              sortOrder: idx,
              type: n.type,
              title: n.title,
              message: n.message,
              orderId: n.orderId ?? null,
              orderNumber: n.orderNumber ?? null,
              customerName: n.customerName ?? null,
              amount: n.amount ?? null,
              read: n.read,
              emailNotifiedTo: n.emailNotifiedTo ?? null,
              createdAt: n.createdAt
            }).onConflictDoUpdate({
              target: adminNotifications.id,
              set: {
                sortOrder: idx,
                read: n.read,
                title: n.title,
                message: n.message,
                emailNotifiedTo: n.emailNotifiedTo ?? null
              }
            });
          }
          if (notifIds.length > 0) {
            await tx.delete(adminNotifications).where(notInArray(adminNotifications.id, notifIds));
          } else {
            await tx.delete(adminNotifications);
          }
          const intentIds = Object.keys(state.paymentIntents || {});
          for (const intentId of intentIds) {
            const rec = state.paymentIntents[intentId];
            await tx.insert(paymentIntents).values({
              razorpayOrderId: rec.razorpayOrderId,
              amountPaise: rec.amountPaise,
              verified: rec.verified,
              paymentId: rec.paymentId ?? null,
              signatureVerified: rec.signatureVerified,
              method: rec.method,
              createdAt: rec.createdAt
            }).onConflictDoUpdate({
              target: paymentIntents.razorpayOrderId,
              set: {
                amountPaise: rec.amountPaise,
                verified: rec.verified,
                paymentId: rec.paymentId ?? null,
                signatureVerified: rec.signatureVerified,
                method: rec.method
              }
            });
          }
          if (intentIds.length > 0) {
            await tx.delete(paymentIntents).where(notInArray(paymentIntents.razorpayOrderId, intentIds));
          } else {
            await tx.delete(paymentIntents);
          }
        })
      );
      logStructured("info", "cloud-sql", "persist_state_success", {
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      logStructured("error", "cloud-sql", "persist_state_failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new StorePersistenceError("Database save failed. Please try again shortly.", {
        code: "POSTGRES_WRITE_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
};

// server/store.ts
function hashPassword(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const hash = crypto2.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
async function hashPasswordAsync(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const derived = await new Promise((resolve, reject) => {
    crypto2.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
  });
  return `${salt}:${derived.toString("hex")}`;
}
async function verifyPasswordAsync(password, storedHash) {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derived = await new Promise((resolve, reject) => {
    crypto2.scrypt(
      password,
      salt,
      64,
      (err, derivedKey) => err ? reject(err) : resolve(derivedKey)
    );
  });
  const keyBuf = Buffer.from(key, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto2.timingSafeEqual(derived, keyBuf);
}
function getAdminOwnerEmail() {
  return (process.env.ADMIN_EMAIL || "himrudraofficial@gmail.com").trim().toLowerCase();
}
function getInitialAdminPassword() {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) {
    throw new Error("ADMIN_PASSWORD environment variable is required.");
  }
  return password;
}
var IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
var BUNDLED_DATA_DIR = path.resolve(process.cwd(), "data");
var BUNDLED_DB_FILE = path.join(BUNDLED_DATA_DIR, "himrudra-db.json");
var DATA_DIR = IS_SERVERLESS ? path.join(os.tmpdir(), "himrudra-data") : BUNDLED_DATA_DIR;
var DB_FILE = path.join(DATA_DIR, "himrudra-db.json");
function createSeedState() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ownerEmail = getAdminOwnerEmail();
  const users2 = [
    {
      id: "usr-owner-1",
      name: "Rahul Mewara (Store Owner)",
      email: ownerEmail,
      phone: "9549572457",
      role: "admin",
      passwordHash: hashPassword(getInitialAdminPassword()),
      createdAt: "2026-08-01T08:00:00.000Z",
      wishlistProductIds: []
    }
  ];
  const products2 = [
    {
      id: "himrudra-shilajit-20g",
      slug: "himalayan-shilajit-resin-20g",
      name: "HimRudra Himalayan Shilajit Resin",
      subtitle: "Pure by Himalayas \xB7 20 g Glass Apothecary Jar",
      netQuantity: "20 g",
      sku: "HR-SHJ-20G",
      hsnCode: "30049011",
      mrp: 1299,
      price: 799,
      costPerUnit: 295,
      stock: 48,
      lowStockThreshold: 10,
      batchNumber: "HR-SHJ-2026-B04",
      gstRatePercent: 12,
      shortDescription: "HimRudra Himalayan Shilajit Resin brings a traditional Himalayan wellness ingredient into a modern, premium experience. Presented in a 20 g jar, this resin is designed for customers who value thoughtful sourcing, clear product information and an uncomplicated daily routine.",
      usageGuidance: "Take a small amount using a normal spoon and dissolve completely in lukewarm water, warm milk, or herbal tea. Stir well until dissolved and consume once daily or as advised by a qualified practitioner.",
      storageInstructions: "Keep the amber glass jar tightly sealed after each use. Store in a cool, dry place away from direct sunlight. Resin consistency naturally firms in cooler weather and softens in warmth.",
      shippingNote: "Free standard pan-India delivery during our launch offer (until 30 November 2026). After the offer ends, standard delivery is \u20B9100 (3\u20135 business days). Cash on Delivery fee is \u20B9100.",
      returnPolicy: "Unopened, tamper-sealed jars are eligible for return or replacement within 7 days of delivery. Damaged-in-transit replacements are processed within 48 hours of photo verification.",
      specifications: [
        { label: "Net Quantity", value: "20 g (approx. 40 servings)" },
        { label: "Form", value: "Semi-solid dark mineral resin" },
        { label: "Container", value: "UV-protected amber glass jar with brushed gold cap" },
        { label: "Included Accessory", value: "Normal measuring spoon" },
        { label: "Active Batch Code", value: "HR-SHJ-2026-B04" },
        { label: "Shelf Life", value: "24 months from packaging date" }
      ],
      galleryTypes: ["hero", "box", "texture", "ritual"],
      customImages: [
        "/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg",
        "/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg"
      ],
      active: true
    },
    {
      id: "himrudra-shilajit-40g-duo",
      slug: "himalayan-shilajit-resin-twin-ritual-pack",
      name: "HimRudra Twin Ritual Pack (2 \xD7 20 g)",
      subtitle: "Two 20 g Apothecary Jars \xB7 Extended Daily Supply",
      netQuantity: "40 g (2 \xD7 20 g)",
      sku: "HR-SHJ-40G-DUO",
      hsnCode: "30049011",
      mrp: 2598,
      price: 1499,
      costPerUnit: 560,
      stock: 22,
      lowStockThreshold: 6,
      batchNumber: "HR-SHJ-2026-B04",
      gstRatePercent: 12,
      shortDescription: "Two individually sealed 20 g jars of HimRudra Himalayan Shilajit Resin crafted for consistent two-to-four month household rituals.",
      usageGuidance: "Take a small amount using a normal spoon and dissolve completely in lukewarm water, warm milk, or herbal tea once daily. Keep the second jar sealed until ready to open.",
      storageInstructions: "Store in a cool, dry cabinet away from moisture and direct heat.",
      shippingNote: "Free standard pan-India delivery during our launch offer (until 30 November 2026). After the offer ends, standard delivery is \u20B9100. Cash on Delivery fee is \u20B9100.",
      returnPolicy: "Unopened jars with intact tamper seals qualify for return within 7 days of delivery.",
      specifications: [
        { label: "Net Quantity", value: "40 g (Two 20 g jars)" },
        { label: "Form", value: "Traditional mineral-rich resin" },
        { label: "Packaging", value: "Dual keepsake boxes with 2 normal spoons" },
        { label: "Active Batch Code", value: "HR-SHJ-2026-B04" }
      ],
      galleryTypes: ["box", "hero", "texture", "ritual"],
      customImages: [
        "/assets/products/himrudra-twin-ritual-pack-40g.jpeg",
        "/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg"
      ],
      active: true
    }
  ];
  const settings = {
    standardShippingFee: 100,
    expressShippingFee: 149,
    freeShippingThreshold: 0,
    codFee: 100,
    codEnabled: true,
    gstIncludedInPrice: true,
    gatewayFeePercent: 2,
    defaultShippingCostPerOrder: 65,
    orderNotificationEmail: "himrudraofficial@gmail.com",
    emailNotificationsEnabled: true,
    brandEmail: "himrudraofficial@gmail.com",
    brandPhone: "9549572457",
    brandAddress: "Marketed by- KP Enterprise, Office No 4-D fourth, Vardan Exclusive, Tower, Lakhudi Rd, near SARDAR PATEL STADIUM, Navrangpura, Ahmedabad, Gujarat 380009",
    announcementText: "LIMITED-TIME OFFER \u2014 FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!",
    seoTitle: "HimRudra \u2014 Pure by Himalayas | Himalayan Shilajit Resin (20 g)",
    seoDescription: "Born in the Himalayas. Crafted for Your Ritual. Shop HimRudra Himalayan Shilajit Resin (20 g) with batch-level laboratory documentation."
  };
  const coupons2 = [
    {
      code: "RITUAL10",
      discountType: "percent",
      value: 10,
      minOrderAmount: 799,
      active: true,
      description: "10% privilege savings on orders \u20B9799+"
    },
    {
      code: "HIMALAYA50",
      discountType: "flat",
      value: 50,
      minOrderAmount: 799,
      active: true,
      description: "Flat \u20B950 off on single or twin pack orders"
    }
  ];
  const promotions2 = [
    {
      id: "promo-freeship-nov26",
      title: "Limited-Time Free Shipping Offer",
      description: "Free standard pan-India shipping on all orders placed before 1 December 2026.",
      bannerHeadline: "LIMITED-TIME OFFER \u2014 FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!",
      bannerSubtext: "Hurry! Order Your HimRudra Shilajit Today.",
      bannerTheme: "crystal-brown-gold",
      startsAt: "2026-11-01T00:00:00+05:30",
      endsAt: FREE_SHIPPING_PROMO_END_ISO,
      freeShipping: true,
      freeShippingSpeed: "standard",
      discountPercent: 0,
      enabled: true,
      usageCount: 0,
      revenueGenerated: 0,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z"
    }
  ];
  const orders2 = [];
  const labReports2 = [
    {
      id: "lab-b04",
      laboratoryName: "Eurofins Analytical Services (Reference Document Format)",
      reportNumber: "COA-1026134",
      testedBatchNumber: "1026134",
      testDate: "2026-10-05",
      mappedProductIds: ["himrudra-shilajit-20g", "himrudra-shilajit-40g-duo"],
      testingMethodology: "Fulvic Acid Assay (77.15%), Heavy Metals & Microbiological Screening",
      verifiedStatus: "Reference Sample",
      notes: "Reference Certificate of Analysis document attached for store review (Batch 1026134, Mfg. 10/2026, Exp. 09/2029). Kept unaltered as a reference format until the store owner uploads and marks an independently verifiable laboratory PDF as Verified.",
      customDocumentUrl: "/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.56.54_PM__1__2115dbef.jpeg",
      heavyMetals: [
        {
          parameter: "Fulvic Acid (Active Component)",
          method: "Eurofins Assay",
          specificationLimit: "Reference Batch",
          observedResult: "77.15%",
          status: "Within Limit"
        },
        {
          parameter: "Lead (Pb)",
          method: "Reference COA",
          specificationLimit: "NMT Specification",
          observedResult: "Meets Specification (Pass)",
          status: "Within Limit"
        },
        {
          parameter: "Arsenic (As)",
          method: "Reference COA",
          specificationLimit: "NMT Specification",
          observedResult: "Meets Specification (Pass)",
          status: "Within Limit"
        },
        {
          parameter: "Mercury (Hg)",
          method: "Reference COA",
          specificationLimit: "NMT Specification",
          observedResult: "Meets Specification (Pass)",
          status: "Within Limit"
        },
        {
          parameter: "Cadmium (Cd)",
          method: "Reference COA",
          specificationLimit: "NMT Specification",
          observedResult: "Meets Specification (Pass)",
          status: "Within Limit"
        }
      ],
      microbiological: [
        {
          parameter: "Aerobic Plate Count",
          method: "Plate Count",
          limit: "Acceptable Limit",
          observedResult: "<100 CFU/g",
          status: "Conforms"
        },
        {
          parameter: "Yeast & Mold Count",
          method: "Plate Count",
          limit: "Acceptable Limit",
          observedResult: "\u2264200 CFU/g (within acceptable limits)",
          status: "Conforms"
        },
        {
          parameter: "E. coli / Salmonella / Pseudomonas / Staphylococcus",
          method: "Pathogen Screen",
          limit: "Absent",
          observedResult: "Absent",
          status: "Absent"
        }
      ],
      updatedAt: now
    }
  ];
  const cmsSections2 = [
    {
      id: "cms-what-is",
      key: "what_is_shilajit",
      title: "What is Shilajit?",
      category: "product",
      content: "Shilajit is a dark, tar-like mineral resin traditionally gathered from high-altitude Himalayan rock crevices, where plant matter and geological minerals undergo slow natural transformation over centuries. In classical Indian traditions, it is valued as a concentrated mineral-organic substance prepared for mindful daily use.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-ingredients",
      key: "product_ingredients",
      title: "Product Ingredients",
      category: "product",
      content: "100% Shilajit Resin (Asphaltum punjabianum) presented in a 20 g semi-solid resin format with no added synthetic colors, artificial flavors, gums, or fillers.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-origin",
      key: "origin_sourcing",
      title: "Origin and Sourcing",
      category: "product",
      content: "Sourced from Himalayan mineral-bearing regions and processed in small batches with water-based purification and controlled low-temperature concentration. Every jar carries a batch code linked to the Quality & Transparency registry.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-how-to-use",
      key: "how_to_use",
      title: "How to Use",
      category: "product",
      content: "Take a small amount using a normal spoon and dissolve completely in lukewarm water, warm milk, or herbal tea. Stir until the liquid turns a rich amber-brown and consume once daily as part of your morning or evening routine.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-storage",
      key: "storage_handling",
      title: "Storage and Handling",
      category: "product",
      content: "Always close the inner protective disc and outer gold cap tightly after use. Keep at room temperature in a cool, dry place away from direct sunlight. Natural resin stiffens slightly in winter and becomes more pliable in warmer weather; warming the closed jar briefly in your palms restores smooth scooping.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-precautions",
      key: "precautions",
      title: "Precautions",
      category: "product",
      content: "Intended for adult use only. Not recommended for pregnant or nursing women, children, or individuals with elevated uric acid, gout, hemochromatosis, or known kidney conditions without medical guidance. This traditional wellness product is not intended to diagnose, treat, cure, or prevent any disease.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-batch-testing",
      key: "batch_testing",
      title: "Batch Testing",
      category: "product",
      content: "Each production batch is logged in our Quality & Transparency center alongside heavy metal screening parameters, microbiological limits, and view-only laboratory reference records maintained by the store administrator.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-faq-1",
      key: "faq_texture",
      title: "Why does the resin texture change between summer and winter?",
      category: "faq",
      content: "Genuine mineral resin responds naturally to ambient temperature\u2014becoming firmer when cool and softer in warmer weather. Warming the closed jar briefly in your palms restores smooth scooping.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-faq-2",
      key: "faq_solubility",
      title: "Does HimRudra Shilajit dissolve completely in warm water?",
      category: "faq",
      content: "Yes. A serving dissolves smoothly in lukewarm water, warm milk, or herbal tea into a rich amber-brown infusion without leaving gritty sand residue.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-faq-3",
      key: "faq_duration",
      title: "How long does one 20 g jar of HimRudra Shilajit last?",
      category: "faq",
      content: "At the recommended serving of 500 mg daily, a single 20 g apothecary jar lasts approximately 40 days.",
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    },
    {
      id: "cms-faq-4",
      key: "faq_certificate",
      title: "Is HimRudra Shilajit lab certified and can I download the report?",
      category: "faq",
      content: 'Yes. Every production batch is laboratory screened for Fulvic Acid assay, heavy metals, and microbiological safety. Click "Lab Certified" in the top navigation bar anytime to preview or download the official batch certificate.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now
    }
  ];
  const expenses2 = [];
  const inquiries2 = [];
  const adminNotifications2 = [];
  return {
    users: users2,
    products: products2,
    settings,
    coupons: coupons2,
    promotions: promotions2,
    orders: orders2,
    labReports: labReports2,
    cmsSections: cmsSections2,
    expenses: expenses2,
    inquiries: inquiries2,
    adminNotifications: adminNotifications2,
    paymentIntents: {}
  };
}
var StoreRepository = class {
  constructor() {
    this.postgres = null;
    this.postgresInitialized = false;
    this.dynamo = null;
    this.dynamoInitialized = false;
    this.lastPersistedFingerprints = /* @__PURE__ */ new Map();
    this.hydratedFromCloud = false;
    this.lastHydratedAtMs = 0;
    this.hydrationPromise = null;
    this.publicBootstrapCache = null;
    this.publicBootstrapPromise = null;
    this.hasServedPublicBootstrap = false;
    this.syncChain = Promise.resolve();
    this.pendingSyncCount = 0;
    this.lastCommitError = null;
    this.lastSyncedAt = null;
    this.lastCloudError = null;
    this.stateVersion = 1;
    this.state = this.loadLocal();
  }
  getPostgres() {
    if (!this.postgresInitialized) {
      this.postgresInitialized = true;
      if (isCloudSqlConfigured()) {
        this.postgres = new PostgresStateAdapter();
      }
    }
    return this.postgres;
  }
  getDynamo() {
    if (this.getPostgres()) return null;
    if (!this.dynamoInitialized) {
      this.dynamoInitialized = true;
      const cfg = getDynamoConfig();
      if (cfg.enabled) {
        this.dynamo = new DynamoStateAdapter(cfg);
      }
    }
    return this.dynamo;
  }
  getStateVersion() {
    return this.stateVersion;
  }
  normalizeState(parsed) {
    let mutated = false;
    for (const p of parsed.products) {
      if (p.id === "himrudra-shilajit-20g" && (!p.customImages || p.customImages.length === 0)) {
        p.customImages = [
          "/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg",
          "/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg"
        ];
        mutated = true;
      } else if (p.id === "himrudra-shilajit-40g-duo" && (!p.customImages || p.customImages.length === 0 || p.customImages[0]?.includes("9.55.23_PM_2635dbf3") || p.customImages[0]?.includes("image_1c70e55c.png"))) {
        p.customImages = [
          "/assets/products/himrudra-twin-ritual-pack-40g.jpeg",
          "/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg"
        ];
        mutated = true;
      }
    }
    for (const rep of parsed.labReports ?? []) {
      if (rep.id === "lab-b04" && rep.heavyMetals?.[0]?.parameter !== "Fulvic Acid (Active Component)") {
        rep.customDocumentUrl = "/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.56.54_PM__1__2115dbef.jpeg";
        rep.laboratoryName = "Eurofins Analytical Services (Reference Document Format)";
        rep.reportNumber = "COA-1026134";
        rep.testedBatchNumber = "1026134";
        rep.testingMethodology = "Fulvic Acid Assay (77.15%), Heavy Metals & Microbiological Screening";
        rep.notes = "Reference Certificate of Analysis document attached for store review (Batch 1026134, Mfg. 10/2026, Exp. 09/2029). Kept unaltered as a reference format until the store owner uploads and marks an independently verifiable laboratory PDF as Verified.";
        rep.heavyMetals = [
          {
            parameter: "Fulvic Acid (Active Component)",
            method: "Eurofins Assay",
            specificationLimit: "Reference Batch",
            observedResult: "77.15%",
            status: "Within Limit"
          },
          {
            parameter: "Lead (Pb)",
            method: "Reference COA",
            specificationLimit: "NMT Specification",
            observedResult: "Meets Specification (Pass)",
            status: "Within Limit"
          },
          {
            parameter: "Arsenic (As)",
            method: "Reference COA",
            specificationLimit: "NMT Specification",
            observedResult: "Meets Specification (Pass)",
            status: "Within Limit"
          },
          {
            parameter: "Mercury (Hg)",
            method: "Reference COA",
            specificationLimit: "NMT Specification",
            observedResult: "Meets Specification (Pass)",
            status: "Within Limit"
          },
          {
            parameter: "Cadmium (Cd)",
            method: "Reference COA",
            specificationLimit: "NMT Specification",
            observedResult: "Meets Specification (Pass)",
            status: "Within Limit"
          }
        ];
        rep.microbiological = [
          {
            parameter: "Aerobic Plate Count",
            method: "Plate Count",
            limit: "Acceptable Limit",
            observedResult: "<100 CFU/g",
            status: "Conforms"
          },
          {
            parameter: "Yeast & Mold Count",
            method: "Plate Count",
            limit: "Acceptable Limit",
            observedResult: "\u2264200 CFU/g (within acceptable limits)",
            status: "Conforms"
          },
          {
            parameter: "E. coli / Salmonella / Pseudomonas / Staphylococcus",
            method: "Pathogen Screen",
            limit: "Absent",
            observedResult: "Absent",
            status: "Absent"
          }
        ];
        mutated = true;
      }
    }
    const ownerEmail = getAdminOwnerEmail();
    const filteredUsers = (parsed.users ?? []).filter((u) => {
      const lower = u.email.toLowerCase();
      if (lower === "admin@himrudra.in") return false;
      if (lower === "atyansharma04488@gmail.com" && ownerEmail !== lower) return false;
      return true;
    });
    if (filteredUsers.length !== (parsed.users ?? []).length) {
      parsed.users = filteredUsers;
    }
    for (const u of parsed.users) {
      if (u.email.toLowerCase() !== ownerEmail && u.role === "admin") {
        u.role = "customer";
        mutated = true;
      }
    }
    const existingOwner = parsed.users.find((u) => u.email.toLowerCase() === ownerEmail);
    if (!existingOwner) {
      parsed.users.unshift({
        id: "usr-owner-1",
        name: "Rahul Mewara (Store Owner)",
        email: ownerEmail,
        phone: "9549572457",
        role: "admin",
        passwordHash: hashPassword(getInitialAdminPassword()),
        createdAt: "2026-08-01T08:00:00.000Z",
        wishlistProductIds: []
      });
      mutated = true;
    } else if (existingOwner.role !== "admin") {
      existingOwner.role = "admin";
      mutated = true;
    }
    if (!Array.isArray(parsed.promotions) || parsed.promotions.length === 0) {
      parsed.promotions = [
        {
          id: "promo-freeship-nov26",
          title: "Limited-Time Free Shipping Offer",
          description: "Free standard pan-India shipping on all orders placed before 1 December 2026.",
          bannerHeadline: "LIMITED-TIME OFFER \u2014 FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!",
          bannerSubtext: "Hurry! Order Your HimRudra Shilajit Today.",
          bannerTheme: "crystal-brown-gold",
          startsAt: "2026-11-01T00:00:00+05:30",
          endsAt: FREE_SHIPPING_PROMO_END_ISO,
          freeShipping: true,
          freeShippingSpeed: "standard",
          discountPercent: 0,
          enabled: true,
          usageCount: 0,
          revenueGenerated: 0,
          createdAt: "2026-11-01T00:00:00.000Z",
          updatedAt: "2026-11-01T00:00:00.000Z"
        }
      ];
      mutated = true;
    }
    if (!Array.isArray(parsed.adminNotifications)) {
      parsed.adminNotifications = [];
      mutated = true;
    }
    if (!parsed.paymentIntents || typeof parsed.paymentIntents !== "object") {
      parsed.paymentIntents = {};
      mutated = true;
    }
    if (parsed.settings) {
      const s = parsed.settings;
      if (typeof s.gatewayFeePercent !== "number") {
        s.gatewayFeePercent = 2;
        mutated = true;
      }
      if (typeof s.defaultShippingCostPerOrder !== "number") {
        s.defaultShippingCostPerOrder = 65;
        mutated = true;
      }
      if (!s.brandEmail) {
        s.brandEmail = "himrudraofficial@gmail.com";
        s.orderNotificationEmail = "himrudraofficial@gmail.com";
        s.emailNotificationsEnabled = true;
        mutated = true;
      }
      if (!s.brandPhone) {
        s.brandPhone = "9549572457";
        mutated = true;
      }
      if (!s.brandAddress) {
        s.brandAddress = "Marketed by- KP Enterprise, Office No 4-D fourth, Vardan Exclusive, Tower, Lakhudi Rd, near SARDAR PATEL STADIUM, Navrangpura, Ahmedabad, Gujarat 380009";
        mutated = true;
      }
      if (s.announcementText === "Batch HR-SHJ-2026-B04 Now Shipping \xB7 Free Delivery \u20B91,499+") {
        s.announcementText = "LIMITED-TIME OFFER \u2014 FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!";
        mutated = true;
      }
    }
    for (const sec of parsed.cmsSections ?? []) {
      if (sec.id === "cms-batch-testing" && sec.content.includes("downloadable")) {
        sec.content = sec.content.replace(
          "downloadable laboratory reference records",
          "view-only laboratory reference records"
        );
        mutated = true;
      }
    }
    for (const ord of parsed.orders ?? []) {
      const normStatus = normalizeLegacyOrderStatus(ord.status);
      if (normStatus !== ord.status) {
        ord.status = normStatus;
        mutated = true;
      }
      for (const ev of ord.timeline ?? []) {
        const normEv = normalizeLegacyOrderStatus(ev.status);
        if (normEv !== ev.status) {
          ev.status = normEv;
          mutated = true;
        }
      }
      if (typeof ord.gatewayFeeAmount !== "number") {
        ord.gatewayFeeAmount = ord.paymentMethod !== "COD" && ord.paymentStatus === "Paid" ? Math.round(ord.totalAmount * 0.02 * 100) / 100 : 0;
        mutated = true;
      }
      if (typeof ord.actualShippingCost !== "number") {
        ord.actualShippingCost = ord.status !== "Cancelled" ? parsed.settings?.defaultShippingCostPerOrder ?? 65 : 0;
        mutated = true;
      }
    }
    return mutated;
  }
  loadLocal() {
    try {
      const sourceFile = fs.existsSync(DB_FILE) ? DB_FILE : fs.existsSync(BUNDLED_DB_FILE) ? BUNDLED_DB_FILE : null;
      if (sourceFile) {
        const raw = fs.readFileSync(sourceFile, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.products) && Array.isArray(parsed.users)) {
          const mutated = this.normalizeState(parsed);
          if (mutated) {
            this.saveLocal(parsed);
          }
          return parsed;
        }
      }
    } catch (err) {
      console.error("Failed to load store file, initializing seed state:", err);
    }
    const seed = createSeedState();
    this.saveLocal(seed);
    return seed;
  }
  saveLocal(nextState) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2), "utf-8");
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      if (!IS_SERVERLESS) {
        throw err;
      }
      console.warn("Skipping non-fatal disk persistence in serverless runtime:", err);
    }
  }
  isPostgresEnabled() {
    return this.getPostgres() !== null;
  }
  isDynamoEnabled() {
    return this.getDynamo() !== null;
  }
  getStorageStatus() {
    const pg = this.getPostgres();
    if (pg) {
      return {
        engine: "cloud-sql-postgresql",
        configured: true,
        hydratedFromCloud: this.hydratedFromCloud,
        lastSyncedAt: this.lastSyncedAt,
        lastError: this.lastCloudError
      };
    }
    const adapter = this.getDynamo();
    if (!adapter) {
      return {
        engine: "local-json",
        configured: false,
        hydratedFromCloud: false,
        lastSyncedAt: this.lastSyncedAt,
        lastError: null
      };
    }
    return {
      engine: "aws-dynamodb",
      configured: true,
      authMode: adapter.config.authMode,
      region: adapter.config.region,
      tableName: adapter.config.tableName,
      hydratedFromCloud: this.hydratedFromCloud,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastCloudError
    };
  }
  async ensureLoaded(options) {
    const pg = this.getPostgres();
    const adapter = pg ? null : this.getDynamo();
    if (!pg && !adapter) return;
    if (this.pendingSyncCount > 0) {
      await this.flushPendingSync().catch(() => {
      });
    }
    const nowMs = Date.now();
    const cacheTtlMs = IS_SERVERLESS ? 6e4 : 3e4;
    const isFresh = this.hydratedFromCloud && nowMs - this.lastHydratedAtMs < cacheTtlMs;
    if (isFresh && !options?.forceRefresh) {
      return;
    }
    if (this.hydrationPromise) {
      const sharedErr = await this.hydrationPromise;
      if (sharedErr && options?.forceRefresh) {
        throw sharedErr;
      }
      return;
    }
    this.hydrationPromise = (async () => {
      try {
        if (pg) {
          const loaded = await pg.loadState(() => createSeedState());
          if (loaded.empty) {
            await pg.persistState(this.state);
            this.hydratedFromCloud = true;
            this.lastHydratedAtMs = Date.now();
            this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
            this.lastCloudError = null;
            this.stateVersion += 1;
            this.publicBootstrapCache = null;
            return null;
          }
          const mutated = this.normalizeState(loaded.state);
          this.state = loaded.state;
          this.hydratedFromCloud = true;
          this.lastHydratedAtMs = Date.now();
          this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.lastCloudError = null;
          this.stateVersion += 1;
          this.publicBootstrapCache = null;
          if (mutated && options?.forceRefresh) {
            await pg.persistState(this.state);
          }
          return null;
        }
        if (adapter) {
          const items = await adapter.loadAllItems();
          if (items.length === 0) {
            const initialItems = serializeStateToDynamoItems(this.state);
            await adapter.applyDiff(initialItems, []);
            this.lastPersistedFingerprints = new Map(
              initialItems.map((item) => [item.pk, buildItemFingerprint(item)])
            );
            this.hydratedFromCloud = true;
            this.lastHydratedAtMs = Date.now();
            this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
            this.lastCloudError = null;
            this.stateVersion += 1;
            return null;
          }
          const fallbackSeed = createSeedState();
          const reconstructed = deserializeDynamoItemsToState(items, fallbackSeed);
          if (reconstructed) {
            const mutated = this.normalizeState(reconstructed);
            this.state = reconstructed;
            this.lastPersistedFingerprints = new Map(
              items.map((item) => [item.pk, buildItemFingerprint(item)])
            );
            this.hydratedFromCloud = true;
            this.lastHydratedAtMs = Date.now();
            this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
            this.lastCloudError = null;
            this.stateVersion += 1;
            if (mutated) {
              const updatedItems = serializeStateToDynamoItems(this.state);
              const diff = computeDynamoDiff(this.lastPersistedFingerprints, updatedItems);
              await adapter.applyDiff(diff.toPut, diff.toDeletePks);
              this.lastPersistedFingerprints = diff.nextFingerprints;
            }
          }
        }
        return null;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        this.lastCloudError = errorObj.message;
        return errorObj;
      } finally {
        this.hydrationPromise = null;
      }
    })();
    const hydrationErr = await this.hydrationPromise;
    if (hydrationErr && options?.forceRefresh) {
      throw hydrationErr;
    }
  }
  getState() {
    return this.state;
  }
  buildPublicBootstrapFromState(source, nowMs) {
    return {
      products: source.products.filter((p) => p.active),
      settings: source.settings,
      coupons: source.coupons.filter((c) => c.active),
      promotions: getActivePromotions(source.promotions, nowMs),
      labReports: source.labReports,
      cmsSections: source.cmsSections.filter((s) => s.approvedByAdmin),
      serverNow: new Date(nowMs).toISOString()
    };
  }
  /**
   * Fast-path public catalog bootstrap for GET /api/store/bootstrap.
   * On Postgres (Neon / Cloud SQL), runs ONE single SQL round-trip touching ONLY the
   * 6 public tables instead of full 12-table hydration, with in-memory TTL caching and
   * concurrent request coalescing.
   */
  async getPublicBootstrap() {
    const coldStart = !this.hasServedPublicBootstrap;
    this.hasServedPublicBootstrap = true;
    const nowMs = Date.now();
    const cacheTtlMs = IS_SERVERLESS ? 6e4 : 3e4;
    if (this.publicBootstrapCache && this.publicBootstrapCache.stateVersion === this.stateVersion && nowMs - this.publicBootstrapCache.loadedAtMs < cacheTtlMs) {
      return {
        payload: {
          ...this.publicBootstrapCache.data,
          promotions: getActivePromotions(this.publicBootstrapCache.data.promotions, nowMs),
          serverNow: new Date(nowMs).toISOString()
        },
        cacheHit: true,
        coldStart,
        dbMs: 0
      };
    }
    const pg = this.getPostgres();
    if (!pg) {
      await this.ensureLoaded();
      const payload = this.buildPublicBootstrapFromState(this.state, nowMs);
      this.publicBootstrapCache = {
        data: {
          products: payload.products,
          settings: payload.settings,
          coupons: payload.coupons,
          promotions: this.state.promotions,
          labReports: payload.labReports,
          cmsSections: payload.cmsSections
        },
        loadedAtMs: nowMs,
        stateVersion: this.stateVersion
      };
      return { payload, cacheHit: false, coldStart, dbMs: 0 };
    }
    if (this.hydratedFromCloud && nowMs - this.lastHydratedAtMs < cacheTtlMs && this.pendingSyncCount === 0) {
      const payload = this.buildPublicBootstrapFromState(this.state, nowMs);
      this.publicBootstrapCache = {
        data: {
          products: payload.products,
          settings: payload.settings,
          coupons: payload.coupons,
          promotions: this.state.promotions,
          labReports: payload.labReports,
          cmsSections: payload.cmsSections
        },
        loadedAtMs: nowMs,
        stateVersion: this.stateVersion
      };
      return { payload, cacheHit: true, coldStart, dbMs: 0 };
    }
    if (!this.publicBootstrapPromise) {
      this.publicBootstrapPromise = (async () => {
        const res = await pg.loadPublicBootstrap();
        if (res.empty) {
          await this.ensureLoaded();
          const seeded = {
            products: this.state.products.filter((p) => p.active),
            settings: this.state.settings,
            coupons: this.state.coupons.filter((c) => c.active),
            promotions: this.state.promotions,
            labReports: this.state.labReports,
            cmsSections: this.state.cmsSections.filter((s) => s.approvedByAdmin)
          };
          return { data: seeded, dbMs: res.dbMs };
        }
        const effectiveSettings = res.data.settings ?? this.state.settings;
        const effectivePromotions = res.data.promotions.length > 0 ? res.data.promotions : this.state.promotions;
        const data = {
          products: res.data.products,
          settings: effectiveSettings,
          coupons: res.data.coupons,
          promotions: effectivePromotions,
          labReports: res.data.labReports,
          cmsSections: res.data.cmsSections
        };
        return { data, dbMs: res.dbMs };
      })().finally(() => {
        this.publicBootstrapPromise = null;
      });
    }
    try {
      const { data, dbMs } = await this.publicBootstrapPromise;
      const doneMs = Date.now();
      this.publicBootstrapCache = {
        data,
        loadedAtMs: doneMs,
        stateVersion: this.stateVersion
      };
      this.lastSyncedAt = new Date(doneMs).toISOString();
      this.lastCloudError = null;
      return {
        payload: {
          ...data,
          promotions: getActivePromotions(data.promotions, doneMs),
          serverNow: new Date(doneMs).toISOString()
        },
        cacheHit: false,
        coldStart,
        dbMs
      };
    } catch (err) {
      this.lastCloudError = err instanceof Error ? err.message : String(err);
      const fallback = this.buildPublicBootstrapFromState(this.state, Date.now());
      return {
        payload: fallback,
        cacheHit: false,
        coldStart,
        dbMs: Date.now() - nowMs
      };
    }
  }
  mergeUserIntoMemory(saved) {
    const normalizedEmail = saved.email.trim().toLowerCase();
    const idx = this.state.users.findIndex(
      (u) => u.id === saved.id || u.email.toLowerCase() === normalizedEmail
    );
    if (idx >= 0) {
      this.state.users[idx] = saved;
    } else {
      this.state.users.push(saved);
    }
    return saved;
  }
  async findUserByEmail(email) {
    const normalized = email.trim().toLowerCase();
    const pg = this.getPostgres();
    if (pg) {
      const dbUser = await pg.findUserByEmail(normalized);
      if (dbUser) {
        return this.mergeUserIntoMemory(dbUser);
      }
      return null;
    }
    return this.state.users.find((u) => u.email.toLowerCase() === normalized) ?? null;
  }
  async findUserById(id) {
    const inMemory = this.state.users.find((u) => u.id === id);
    if (inMemory) return inMemory;
    const pg = this.getPostgres();
    if (pg) {
      const dbUser = await pg.findUserById(id);
      if (dbUser) {
        return this.mergeUserIntoMemory(dbUser);
      }
    }
    return null;
  }
  async upsertUser(user, uid) {
    const pg = this.getPostgres();
    if (pg) {
      const saved = await pg.upsertUser(user, uid);
      this.mergeUserIntoMemory(saved);
      this.stateVersion += 1;
      this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.lastCloudError = null;
      this.saveLocal(this.state);
      return saved;
    }
    this.mergeUserIntoMemory(user);
    this.commit();
    return user;
  }
  async createUserIfNotExists(user) {
    const normalizedEmail = user.email.trim().toLowerCase();
    const pg = this.getPostgres();
    if (pg) {
      const created = await pg.createUserIfNotExists({ ...user, email: normalizedEmail });
      if (!created) return null;
      this.mergeUserIntoMemory(created);
      this.stateVersion += 1;
      this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.lastCloudError = null;
      this.saveLocal(this.state);
      return created;
    }
    if (this.state.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      return null;
    }
    this.mergeUserIntoMemory({ ...user, email: normalizedEmail });
    this.commit();
    return user;
  }
  async upsertPaymentIntent(intent) {
    const pg = this.getPostgres();
    if (pg) {
      await pg.upsertPaymentIntent(intent);
      this.state.paymentIntents[intent.razorpayOrderId] = intent;
      this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.lastCloudError = null;
      return;
    }
    this.state.paymentIntents[intent.razorpayOrderId] = intent;
    this.commit();
  }
  async findPaymentIntent(razorpayOrderId) {
    const pg = this.getPostgres();
    if (pg) {
      const found = await pg.findPaymentIntent(razorpayOrderId);
      if (found) {
        this.state.paymentIntents[found.razorpayOrderId] = found;
      }
      return found;
    }
    return this.state.paymentIntents[razorpayOrderId] ?? null;
  }
  async loadCheckoutContext(params) {
    const pg = this.getPostgres();
    if (pg) {
      const loaded = await pg.loadCheckoutContext(params);
      if (!loaded.empty) {
        const effectiveSettings = loaded.settings ?? this.state.settings;
        this.state.products = loaded.products;
        this.state.coupons = loaded.coupons;
        this.state.promotions = loaded.promotions;
        this.state.settings = effectiveSettings;
        if (loaded.paymentIntent) {
          this.state.paymentIntents[loaded.paymentIntent.razorpayOrderId] = loaded.paymentIntent;
        }
        return {
          products: loaded.products,
          coupons: loaded.coupons,
          promotions: loaded.promotions,
          settings: effectiveSettings,
          paymentIntent: loaded.paymentIntent,
          existingOrderByPayment: loaded.existingOrderByPayment,
          maxOrderSeq: loaded.maxOrderSeq
        };
      }
      await this.ensureLoaded({ forceRefresh: true });
    }
    const existingOrderByPayment = params?.razorpayPaymentId || params?.razorpayOrderId ? this.state.orders.find(
      (o) => params.razorpayPaymentId && o.razorpayPaymentId === params.razorpayPaymentId || params.razorpayOrderId && o.razorpayOrderId === params.razorpayOrderId
    ) ?? null : null;
    let maxOrderSeq = this.state.orders.length;
    if (params?.includeOrderSequence) {
      for (const existing of this.state.orders) {
        const match = /^HIM-2026-(\d+)$/.exec(existing.orderNumber);
        if (match) {
          const seq = Number(match[1]);
          if (seq > maxOrderSeq) maxOrderSeq = seq;
        }
      }
    }
    return {
      products: this.state.products,
      coupons: this.state.coupons,
      promotions: this.state.promotions,
      settings: this.state.settings,
      paymentIntent: params?.razorpayOrderId ? this.state.paymentIntents[params.razorpayOrderId] ?? null : null,
      existingOrderByPayment,
      maxOrderSeq
    };
  }
  /**
   * Atomically persists a newly placed Order + inventory stock decrement using a PostgreSQL ACID transaction
   * (or DynamoDB TransactWrite when DynamoDB is configured).
   * On PostgreSQL, also atomically updates promotion metrics, admin notification, and user default address
   * inside the same transaction so no full 12-table persistState rewrite is needed.
   */
  async commitOrderAtomic(order, stockDecrements, extras) {
    const pg = this.getPostgres();
    if (pg) {
      const txResult = await pg.transactCreateOrderAndDecrementStock({
        order,
        stockDecrements,
        promotionUpdate: extras?.promotionUpdate,
        adminNotification: extras?.adminNotification,
        userDefaultAddressUpdate: extras?.userDefaultAddressUpdate
      });
      if (txResult.existingOrder) {
        return { existingOrder: txResult.existingOrder };
      }
      for (const upd of txResult.updatedProducts) {
        const prod = this.state.products.find((p) => p.id === upd.id);
        if (prod) {
          prod.stock = upd.stock;
        }
      }
      if (!this.state.orders.some((o) => o.id === order.id)) {
        this.state.orders.unshift(order);
      }
      if (extras?.adminNotification && !this.state.adminNotifications.some((n) => n.id === extras.adminNotification.id)) {
        this.state.adminNotifications.unshift(extras.adminNotification);
      }
      if (extras?.userDefaultAddressUpdate) {
        const u = this.state.users.find((usr) => usr.id === extras.userDefaultAddressUpdate.userId);
        if (u && !u.defaultAddress) {
          u.defaultAddress = extras.userDefaultAddressUpdate.address;
        }
      }
      this.stateVersion += 1;
      this.publicBootstrapCache = null;
      this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.lastCloudError = null;
      this.lastCommitError = null;
      return { updatedProducts: txResult.updatedProducts };
    }
    const adapter = this.getDynamo();
    if (!adapter) {
      this.commit();
      return {};
    }
    const orderItem = {
      pk: `ORDER#${order.id}`,
      entityType: "order",
      sortOrder: 0,
      payload: JSON.parse(JSON.stringify(order)),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await adapter.transactCreateOrderAndDecrementStock({
      orderItem,
      stockDecrements
    });
    this.lastPersistedFingerprints.set(orderItem.pk, buildItemFingerprint(orderItem));
    this.commit();
    await this.flushPendingSync();
    return {};
  }
  commit() {
    this.stateVersion += 1;
    this.publicBootstrapCache = null;
    this.saveLocal(this.state);
    const pg = this.getPostgres();
    if (pg) {
      const snapshot = JSON.parse(JSON.stringify(this.state));
      this.pendingSyncCount += 1;
      this.syncChain = this.syncChain.then(async () => {
        await pg.persistState(snapshot);
        this.lastHydratedAtMs = Date.now();
        this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.lastCloudError = null;
        this.lastCommitError = null;
      }).catch((err) => {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        this.lastCloudError = errorObj.message;
        this.lastCommitError = errorObj;
        this.hydratedFromCloud = false;
      }).finally(() => {
        this.pendingSyncCount = Math.max(0, this.pendingSyncCount - 1);
      });
      return;
    }
    const adapter = this.getDynamo();
    if (!adapter) {
      this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      return;
    }
    const nextItems = serializeStateToDynamoItems(this.state);
    this.pendingSyncCount += 1;
    this.syncChain = this.syncChain.then(async () => {
      const diff = computeDynamoDiff(this.lastPersistedFingerprints, nextItems);
      await adapter.applyDiff(diff.toPut, diff.toDeletePks);
      this.lastPersistedFingerprints = diff.nextFingerprints;
      this.lastHydratedAtMs = Date.now();
      this.lastSyncedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.lastCloudError = null;
      this.lastCommitError = null;
    }).catch((err) => {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      this.lastCloudError = errorObj.message;
      this.lastCommitError = errorObj;
      this.hydratedFromCloud = false;
    }).finally(() => {
      this.pendingSyncCount = Math.max(0, this.pendingSyncCount - 1);
    });
  }
  hasPendingSync() {
    return this.pendingSyncCount > 0;
  }
  async flushPendingSync() {
    await this.syncChain;
    if (this.lastCommitError) {
      const err = this.lastCommitError;
      this.lastCommitError = null;
      throw err;
    }
  }
  sanitizeUser(u) {
    const { passwordHash: _ignored, ...safe } = u;
    return {
      ...safe,
      role: safe.role === "admin" && safe.email.toLowerCase() === getAdminOwnerEmail() ? "admin" : "customer"
    };
  }
};
var storeRepo = new StoreRepository();

// server/firebaseVerify.ts
import crypto3 from "node:crypto";

// firebase-applet-config.json
var firebase_applet_config_default = {
  projectId: "silicon-plane-5cf5x",
  appId: "1:1079464169804:web:d723dc8b72609caa59bfe9",
  apiKey: "AIzaSyD23kmop5IhM11ly6GGjeaMCAlYDrn2mQ0",
  authDomain: "silicon-plane-5cf5x.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-remixhimrudrapur-d6689ec3-f161-40f1-a92f-b79cf4183f61",
  storageBucket: "silicon-plane-5cf5x.firebasestorage.app",
  messagingSenderId: "1079464169804",
  measurementId: "",
  oAuthClientId: "1079464169804-pp3rv7o4peupffdje7t88q1plqcmkp0r.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// src/lib/firebase-admin.ts
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
if (!getApps().length) {
  initializeApp({
    projectId: firebase_applet_config_default.projectId
  });
}
var adminAuth = getAuth();

// server/firebaseVerify.ts
var GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
var cachedCerts = null;
var certsExpiresAt = 0;
function getFirebaseProjectConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY?.trim() || process.env.VITE_FIREBASE_API_KEY?.trim() || firebase_applet_config_default.apiKey || "",
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || process.env.VITE_FIREBASE_PROJECT_ID?.trim() || firebase_applet_config_default.projectId || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN?.trim() || process.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || firebase_applet_config_default.authDomain || ""
  };
}
async function fetchGooglePublicCerts() {
  const now = Date.now();
  if (cachedCerts && now < certsExpiresAt) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certificates (${res.status})`);
  }
  const cacheControl = res.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = await res.json();
  certsExpiresAt = now + Math.max(60, maxAgeSec) * 1e3;
  return cachedCerts;
}
function decodeBase64UrlJson(segment) {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
}
async function verifyJwtWithGoogleCerts(idToken, projectId) {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson(headerB64);
  if (header.alg !== "RS256" || !header.kid) {
    return null;
  }
  const certs = await fetchGooglePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    return null;
  }
  const verifier = crypto3.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const normalizedSig = sigB64.replace(/-/g, "+").replace(/_/g, "/");
  const paddedSig = normalizedSig + "=".repeat((4 - normalizedSig.length % 4) % 4);
  const signatureBuf = Buffer.from(paddedSig, "base64");
  const isValidSig = verifier.verify(certPem, signatureBuf);
  if (!isValidSig) {
    return null;
  }
  const payload = decodeBase64UrlJson(payloadB64);
  const nowSec = Math.floor(Date.now() / 1e3);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (!payload.sub || !payload.email || payload.aud !== projectId || payload.iss !== expectedIssuer || !payload.exp || payload.exp <= nowSec) {
    return null;
  }
  return {
    localId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    displayName: payload.name?.trim() || void 0,
    emailVerified: Boolean(payload.email_verified)
  };
}
async function verifyFirebaseIdToken(idToken) {
  const trimmed = idToken.trim();
  const { apiKey, projectId, authDomain } = getFirebaseProjectConfig();
  if (!projectId && !apiKey) {
    throw new Error("Firebase authentication is not configured on the server.");
  }
  try {
    const decoded = await adminAuth.verifyIdToken(trimmed);
    if (decoded.uid && decoded.email) {
      return {
        localId: decoded.uid,
        email: decoded.email.trim().toLowerCase(),
        displayName: typeof decoded.name === "string" ? decoded.name.trim() || void 0 : void 0,
        emailVerified: Boolean(decoded.email_verified)
      };
    }
  } catch (adminErr) {
    console.warn("Firebase Admin verifyIdToken fallback triggered:", adminErr);
  }
  if (projectId) {
    try {
      const verified = await verifyJwtWithGoogleCerts(trimmed, projectId);
      if (verified) {
        return verified;
      }
    } catch (certErr) {
      console.warn("Google X.509 certificate verification fallback triggered:", certErr);
    }
  }
  if (apiKey) {
    const headers = { "Content-Type": "application/json" };
    if (authDomain) {
      headers.Referer = `https://${authDomain}/`;
    }
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ idToken: trimmed })
      }
    );
    if (lookupRes.ok) {
      const lookupJson = await lookupRes.json();
      const fbUser = lookupJson.users?.[0];
      if (fbUser?.email && fbUser?.localId) {
        return {
          localId: fbUser.localId,
          email: fbUser.email.trim().toLowerCase(),
          displayName: fbUser.displayName?.trim() || void 0,
          emailVerified: Boolean(fbUser.emailVerified)
        };
      }
    }
  }
  throw new Error("Could not verify Google account credentials. Please try again.");
}

// server/s3.ts
import crypto4 from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
function buildS3PublicUrl(config, key) {
  const cleanKey = key.replace(/^\/+/, "");
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${cleanKey}`;
  }
  if (config.endpoint) {
    return `${config.endpoint.replace(/\/+$/, "")}/${config.bucket}/${cleanKey}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${cleanKey}`;
}
function buildS3ObjectKey(prefix, folder, originalFileName) {
  const safeName = sanitizeUploadedFileName(originalFileName);
  const stamp = Date.now();
  const rand = crypto4.randomBytes(4).toString("hex");
  return `${prefix}/${folder}/${stamp}-${rand}-${safeName}`;
}
var S3MediaService = class {
  constructor() {
    this.client = null;
    this.config = null;
    this.initialized = false;
  }
  ensureClient() {
    if (!this.initialized) {
      this.initialized = true;
      const cfg = getAwsS3Config();
      if (cfg.enabled) {
        const { credentials } = resolveAwsAuthMode(process.env, cfg.endpoint);
        this.config = cfg;
        this.client = new S3Client({
          region: cfg.region,
          maxAttempts: 4,
          retryMode: "adaptive",
          ...cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {},
          ...credentials ? { credentials } : {}
        });
        logStructured("info", "aws-s3", "initialized", {
          bucket: cfg.bucket,
          region: cfg.region,
          authMode: cfg.authMode
        });
      }
    }
    if (!this.client || !this.config) return null;
    return { client: this.client, config: this.config };
  }
  isEnabled() {
    return this.ensureClient() !== null;
  }
  getStatus() {
    const active = this.ensureClient();
    if (!active) {
      return {
        engine: "inline-or-local",
        configured: false
      };
    }
    return {
      engine: "aws-s3",
      configured: true,
      bucket: active.config.bucket,
      region: active.config.region,
      authMode: active.config.authMode
    };
  }
  async uploadBuffer(params) {
    const active = this.ensureClient();
    if (!active) {
      throw new StorePersistenceError("AWS S3 is not configured.", {
        code: "S3_NOT_CONFIGURED",
        statusCode: 503
      });
    }
    const startedAt = Date.now();
    const key = buildS3ObjectKey(
      active.config.keyPrefix,
      params.folder || "uploads",
      params.fileName
    );
    try {
      await active.client.send(
        new PutObjectCommand({
          Bucket: active.config.bucket,
          Key: key,
          Body: params.buffer,
          ContentType: params.contentType,
          CacheControl: "public, max-age=31536000, immutable"
        })
      );
      const url = buildS3PublicUrl(active.config, key);
      logStructured("info", "aws-s3", "upload_success", {
        key,
        bytes: params.buffer.length,
        contentType: params.contentType,
        durationMs: Date.now() - startedAt
      });
      return {
        key,
        url,
        bucket: active.config.bucket,
        region: active.config.region,
        bytes: params.buffer.length,
        contentType: params.contentType
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "S3 upload failed";
      logStructured("error", "aws-s3", "upload_failed", {
        key,
        bytes: params.buffer.length,
        durationMs: Date.now() - startedAt,
        error: msg
      });
      throw new StorePersistenceError(`AWS S3 upload failed: ${msg}`, {
        code: "S3_UPLOAD_FAILED",
        statusCode: 503,
        retryable: true
      });
    }
  }
  async fetchObjectByUrl(url) {
    const active = this.ensureClient();
    if (!active) return null;
    const base = buildS3PublicUrl(active.config, "");
    if (!url.startsWith(base)) return null;
    const key = decodeURIComponent(url.slice(base.length).replace(/^\/+/, ""));
    if (!key) return null;
    const res = await active.client.send(
      new GetObjectCommand({
        Bucket: active.config.bucket,
        Key: key
      })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) return null;
    return {
      buffer: Buffer.from(bytes),
      contentType: res.ContentType || "application/octet-stream"
    };
  }
};
var s3MediaService = new S3MediaService();

// server/trafficGuard.ts
var BoundedRateLimiter = class {
  constructor(maxEntries = 1e4) {
    this.buckets = /* @__PURE__ */ new Map();
    this.lastCleanupMs = 0;
    this.maxEntries = maxEntries;
  }
  check(key, rule, nowMs = Date.now()) {
    if (nowMs - this.lastCleanupMs > 3e4 || this.buckets.size > this.maxEntries) {
      this.cleanup(nowMs);
    }
    const existing = this.buckets.get(key);
    if (!existing || nowMs >= existing.resetAt) {
      this.buckets.set(key, {
        count: 1,
        resetAt: nowMs + rule.windowMs
      });
      return {
        allowed: true,
        remaining: Math.max(0, rule.maxRequests - 1),
        retryAfterSec: 0
      };
    }
    if (existing.count >= rule.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1e3))
      };
    }
    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, rule.maxRequests - existing.count),
      retryAfterSec: 0
    };
  }
  cleanup(nowMs) {
    this.lastCleanupMs = nowMs;
    for (const [k, entry] of this.buckets.entries()) {
      if (nowMs >= entry.resetAt) {
        this.buckets.delete(k);
      }
    }
    if (this.buckets.size > this.maxEntries) {
      const toDrop = this.buckets.size - Math.floor(this.maxEntries * 0.8);
      let dropped = 0;
      for (const k of this.buckets.keys()) {
        this.buckets.delete(k);
        dropped += 1;
        if (dropped >= toDrop) break;
      }
    }
  }
};
var InFlightConcurrencyGuard = class {
  constructor(maxInFlight = 800) {
    this.active = 0;
    this.peak = 0;
    this.shedCount = 0;
    this.maxInFlight = maxInFlight;
  }
  tryEnter() {
    if (this.active >= this.maxInFlight) {
      this.shedCount += 1;
      return false;
    }
    this.active += 1;
    if (this.active > this.peak) {
      this.peak = this.active;
    }
    return true;
  }
  leave() {
    this.active = Math.max(0, this.active - 1);
  }
  getStats() {
    return {
      activeInFlight: this.active,
      peakInFlight: this.peak,
      maxInFlight: this.maxInFlight,
      shedCount: this.shedCount
    };
  }
};
var BootstrapResponseCache = class {
  constructor(ttlMs = 1e4) {
    this.cached = null;
    this.ttlMs = ttlMs;
  }
  get(nowMs = Date.now()) {
    if (this.cached && nowMs < this.cached.expiresAtMs) {
      return this.cached;
    }
    return null;
  }
  set(payload, nowMs = Date.now()) {
    const json = JSON.stringify(payload);
    let hash = 2166136261;
    for (let i = 0; i < json.length; i += 1) {
      hash ^= json.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const etag = `W/"hr-${(hash >>> 0).toString(16)}-${json.length}"`;
    this.cached = {
      json,
      etag,
      expiresAtMs: nowMs + this.ttlMs
    };
    return this.cached;
  }
  invalidate() {
    this.cached = null;
  }
};
function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}
function createTrafficGuardMiddleware(options) {
  const limiter = options?.limiter ?? new BoundedRateLimiter(15e3);
  const concurrency = new InFlightConcurrencyGuard(options?.maxInFlight ?? 800);
  const middleware = (req, res, next) => {
    const requestId = createRequestId();
    res.setHeader("X-Request-Id", requestId);
    req.requestId = requestId;
    if (!concurrency.tryEnter()) {
      res.setHeader("Retry-After", "2");
      logStructured("warn", "traffic-guard", "load_shed", {
        requestId,
        path: req.path,
        ...concurrency.getStats()
      });
      return res.status(503).json({
        error: "HimRudra is experiencing heavy traffic right now. Please retry in a moment.",
        retryAfterSec: 2
      });
    }
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        concurrency.leave();
      }
    };
    res.on("finish", release);
    res.on("close", release);
    const ip = getClientIp(req);
    const p = req.path;
    let bucket = "general";
    let rule = { windowMs: 6e4, maxRequests: 1200 };
    if (p === "/auth/login" || p === "/auth/register" || p === "/auth/google") {
      bucket = "auth";
      rule = { windowMs: 6e4, maxRequests: 40 };
    } else if (p === "/inquiries" || p === "/chat") {
      bucket = "contact";
      rule = { windowMs: 6e4, maxRequests: 25 };
    } else if (p.startsWith("/payments/")) {
      bucket = "payments";
      rule = { windowMs: 6e4, maxRequests: 60 };
    } else if (p === "/orders" && req.method === "POST") {
      bucket = "orders";
      rule = { windowMs: 6e4, maxRequests: 40 };
    } else if (p === "/health" || p === "/store/bootstrap") {
      bucket = "public-read";
      rule = { windowMs: 6e4, maxRequests: 3e3 };
    }
    const result = limiter.check(`${bucket}:${ip}`, rule);
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      logStructured("warn", "traffic-guard", "rate_limited", {
        requestId,
        bucket,
        path: p,
        retryAfterSec: result.retryAfterSec
      });
      return res.status(429).json({
        error: "Too many requests. Please wait a few seconds and try again.",
        retryAfterSec: result.retryAfterSec
      });
    }
    next();
  };
  return {
    middleware,
    concurrency,
    limiter
  };
}

// server/razorpay.ts
import crypto5 from "node:crypto";
var RAZORPAY_ORDER_ID_PATTERN = /^order_[A-Za-z0-9]{6,50}$/;
var RAZORPAY_PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{6,50}$/;
var RAZORPAY_SIGNATURE_HEX_PATTERN = /^[a-f0-9]{64}$/i;
function getRazorpayConfig(env = process.env) {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    return null;
  }
  const mode = keyId.startsWith("rzp_test_") ? "test" : keyId.startsWith("rzp_live_") ? "live" : "custom";
  return { keyId, keySecret, mode };
}
function isValidRazorpayOrderId(orderId) {
  return typeof orderId === "string" && RAZORPAY_ORDER_ID_PATTERN.test(orderId.trim());
}
function isValidRazorpayPaymentId(paymentId) {
  return typeof paymentId === "string" && RAZORPAY_PAYMENT_ID_PATTERN.test(paymentId.trim());
}
function normalizeRazorpayPaymentMethod(rawMethod, fallback) {
  const mapToken = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
    switch (normalized) {
      case "upi":
        return "UPI";
      case "card":
      case "creditcard":
      case "debitcard":
        return "Card";
      case "netbanking":
      case "banktransfer":
        return "NetBanking";
      case "wallet":
        return "Wallet";
      case "emi":
      case "cardlessemi":
        return "EMI";
      case "paylater":
        return "PayLater";
      case "online":
        return "Online";
      default:
        return null;
    }
  };
  return mapToken(rawMethod) ?? mapToken(fallback) ?? "Online";
}
function verifyRazorpaySignature(params) {
  const signature = params.razorpaySignature.trim();
  if (!RAZORPAY_SIGNATURE_HEX_PATTERN.test(signature)) {
    return false;
  }
  const expected = crypto5.createHmac("sha256", params.keySecret).update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`).digest("hex");
  const sigBuf = Buffer.from(signature.toLowerCase(), "utf8");
  const expBuf = Buffer.from(expected.toLowerCase(), "utf8");
  return sigBuf.length === expBuf.length && crypto5.timingSafeEqual(sigBuf, expBuf);
}
function verifyRazorpayWebhookSignature(params) {
  const signature = params.signature.trim();
  const secret = params.webhookSecret.trim();
  if (!secret || !RAZORPAY_SIGNATURE_HEX_PATTERN.test(signature)) {
    return false;
  }
  const expected = crypto5.createHmac("sha256", secret).update(params.rawBody).digest("hex");
  const sigBuf = Buffer.from(signature.toLowerCase(), "utf8");
  const expBuf = Buffer.from(expected.toLowerCase(), "utf8");
  return sigBuf.length === expBuf.length && crypto5.timingSafeEqual(sigBuf, expBuf);
}
function validateRazorpayPaymentDetails(payment, expected) {
  const expectedCurrency = (expected.currency ?? "INR").toUpperCase();
  const requireCaptured = expected.requireCaptured ?? true;
  if (!payment || typeof payment !== "object") {
    return {
      ok: false,
      statusCode: 502,
      code: "RAZORPAY_INVALID_RESPONSE",
      message: "Razorpay returned an invalid payment response. Please contact support."
    };
  }
  if (payment.id !== expected.razorpayPaymentId) {
    return {
      ok: false,
      statusCode: 400,
      code: "RAZORPAY_PAYMENT_ID_MISMATCH",
      message: "Payment transaction reference does not match Razorpay records."
    };
  }
  if (payment.order_id !== expected.razorpayOrderId) {
    return {
      ok: false,
      statusCode: 400,
      code: "RAZORPAY_ORDER_ID_MISMATCH",
      message: "Payment does not belong to this Razorpay order."
    };
  }
  if (Number(payment.amount) !== expected.amountPaise) {
    return {
      ok: false,
      statusCode: 400,
      code: "RAZORPAY_AMOUNT_MISMATCH",
      message: "Paid amount does not match the expected order total."
    };
  }
  if (String(payment.currency || "").toUpperCase() !== expectedCurrency) {
    return {
      ok: false,
      statusCode: 400,
      code: "RAZORPAY_CURRENCY_MISMATCH",
      message: `Payment currency must be ${expectedCurrency}.`
    };
  }
  if (requireCaptured && payment.status !== "captured") {
    return {
      ok: false,
      statusCode: 402,
      code: "RAZORPAY_PAYMENT_NOT_CAPTURED",
      message: payment.status === "failed" ? payment.error_description || "Payment failed at the bank or gateway. Please try again." : `Payment has not been captured yet (status: ${payment.status || "unknown"}).`
    };
  }
  return { ok: true, payment };
}
function buildBasicAuthHeader(config) {
  return `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
}
async function createRazorpayServerOrder(params) {
  const fetchFn = params.fetchImpl ?? fetch;
  try {
    const rzpRes = await fetchFn("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: buildBasicAuthHeader(params.config),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: params.amountPaise,
        currency: (params.currency ?? "INR").toUpperCase(),
        receipt: params.receipt,
        payment_capture: 1,
        notes: params.notes ?? { store: "HimRudra" }
      })
    });
    const rzpData = await rzpRes.json().catch(() => ({}));
    if (!rzpRes.ok || !isValidRazorpayOrderId(rzpData.id)) {
      return {
        ok: false,
        statusCode: 502,
        gatewayStatus: rzpRes.status,
        message: rzpData.error?.description || "Payment gateway could not initialize your order. Please try again."
      };
    }
    return { ok: true, razorpayOrderId: rzpData.id, status: rzpRes.status };
  } catch {
    return {
      ok: false,
      statusCode: 502,
      message: "Unable to reach Razorpay payment gateway. Please retry in a moment."
    };
  }
}
async function fetchAndVerifyCapturedRazorpayPayment(params) {
  const fetchFn = params.fetchImpl ?? fetch;
  const expectedCurrency = (params.expectedCurrency ?? "INR").toUpperCase();
  const authHeader = buildBasicAuthHeader(params.config);
  let payment;
  try {
    const fetchRes = await fetchFn(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(params.razorpayPaymentId)}`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
          Accept: "application/json"
        }
      }
    );
    const payload = await fetchRes.json().catch(() => ({}));
    if (!fetchRes.ok) {
      return {
        ok: false,
        statusCode: fetchRes.status === 404 ? 400 : 502,
        code: "RAZORPAY_PAYMENT_FETCH_FAILED",
        message: payload.error?.description || "Could not verify payment details with Razorpay. Please retry."
      };
    }
    payment = payload;
  } catch {
    return {
      ok: false,
      statusCode: 502,
      code: "RAZORPAY_PAYMENT_FETCH_NETWORK_ERROR",
      message: "Unable to reach Razorpay to confirm your payment. Please retry."
    };
  }
  const preCaptureCheck = validateRazorpayPaymentDetails(payment, {
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    amountPaise: params.expectedAmountPaise,
    currency: expectedCurrency,
    requireCaptured: false
  });
  if (!preCaptureCheck.ok) {
    return preCaptureCheck;
  }
  if (payment.status === "authorized") {
    try {
      const captureRes = await fetchFn(
        `https://api.razorpay.com/v1/payments/${encodeURIComponent(params.razorpayPaymentId)}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            amount: params.expectedAmountPaise,
            currency: expectedCurrency
          })
        }
      );
      const capturedPayload = await captureRes.json().catch(() => ({}));
      if (!captureRes.ok) {
        return {
          ok: false,
          statusCode: 402,
          code: "RAZORPAY_CAPTURE_FAILED",
          message: capturedPayload.error?.description || "Razorpay could not capture this payment. No order was placed."
        };
      }
      payment = capturedPayload;
    } catch {
      return {
        ok: false,
        statusCode: 502,
        code: "RAZORPAY_CAPTURE_NETWORK_ERROR",
        message: "Unable to complete payment capture with Razorpay. Please retry."
      };
    }
  }
  return validateRazorpayPaymentDetails(payment, {
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    amountPaise: params.expectedAmountPaise,
    currency: expectedCurrency,
    requireCaptured: true
  });
}

// server.ts
dotenv.config({ path: ".env.local" });
dotenv.config();
var PORT = Number(process.env.PORT) || 3e3;
var IS_SERVERLESS2 = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
var SESSION_COOKIE = "himrudra_session";
var USING_FALLBACK_SESSION_SECRET = !process.env.SESSION_SECRET || process.env.SESSION_SECRET === "change-me-in-production";
var SESSION_SECRET = USING_FALLBACK_SESSION_SECRET ? "himrudra-dev-session-hmac-secret-2026" : process.env.SESSION_SECRET;
if (USING_FALLBACK_SESSION_SECRET && process.env.NODE_ENV === "production") {
  logStructured("warn", "security", "session_secret_fallback_in_production", {
    message: "SESSION_SECRET env var is not configured; set a strong random secret in production."
  });
}
function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto6.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}
function verifySession(token) {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expected = crypto6.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto6.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    if (!payload.userId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    const rawValue = part.slice(idx + 1).trim();
    try {
      map[k] = decodeURIComponent(rawValue);
    } catch {
      map[k] = rawValue;
    }
  }
  return map;
}
async function attachUser(req, _res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : void 0;
    const candidateTokens = [bearerToken, cookies[SESSION_COOKIE]].filter(
      (t) => Boolean(t)
    );
    for (const rawToken of candidateTokens) {
      const session = verifySession(rawToken);
      if (!session) continue;
      const user = await storeRepo.findUserById(session.userId).catch(() => null);
      if (user) {
        req.currentUser = user;
        break;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}
function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).json({ error: "Authentication required. Please sign in." });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).json({
      error: "Admin session expired or missing. Please sign in as the store owner.",
      code: "ADMIN_AUTH_REQUIRED"
    });
  }
  if (!isAuthorizedAdmin(req.currentUser, getAdminOwnerEmail())) {
    return res.status(403).json({
      error: "Private store owner access required.",
      code: "ADMIN_FORBIDDEN"
    });
  }
  next();
}
function isHttpsRequest(req) {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return Boolean(req.secure || proto?.includes("https") || process.env.NODE_ENV === "production");
}
function setSessionCookie(req, res, user) {
  const token = signSession({
    userId: user.id,
    role: user.role,
    exp: Date.now() + 1e3 * 60 * 60 * 24 * 7
  });
  const secure = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    maxAge: 1e3 * 60 * 60 * 24 * 7,
    path: "/"
  });
  return token;
}
function createApiApp() {
  const app2 = express();
  app2.set("trust proxy", 1);
  app2.disable("x-powered-by");
  app2.use(
    express.json({
      limit: "5mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf-8");
      }
    })
  );
  const trafficGuard = createTrafficGuardMiddleware({ maxInFlight: 800 });
  const bootstrapCache = new BootstrapResponseCache(1e4);
  let lastBootstrapStateVersion = -1;
  app2.use("/api", trafficGuard.middleware);
  app2.use("/api", async (req, res, next) => {
    try {
      const isMutation = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
      const isDirectPostgresRoute = storeRepo.isPostgresEnabled() && (req.path === "/auth/login" || req.path === "/auth/register" || req.path === "/auth/google" || req.path === "/auth/logout" || req.path === "/auth/profile" || req.path === "/auth/wishlist" || req.path === "/payments/create-order" || req.path === "/payments/verify" || req.method === "POST" && req.path === "/orders");
      if (!isDirectPostgresRoute) {
        await storeRepo.ensureLoaded({ forceRefresh: isMutation });
      }
      if (isMutation) {
        const origJson = res.json.bind(res);
        res.json = ((body) => {
          if (storeRepo.hasPendingSync()) {
            void storeRepo.flushPendingSync().then(() => {
              origJson(body);
            }).catch((err) => {
              const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
              const code = err instanceof StorePersistenceError ? err.code : "PERSISTENCE_FAILED";
              const message = err instanceof Error ? err.message : "Unable to save changes to the cloud database. Please retry.";
              logStructured("error", "api", "db_flush_failed", {
                requestId: req.requestId,
                method: req.method,
                path: req.path,
                code,
                statusCode,
                error: message
              });
              if (!res.headersSent) {
                res.status(statusCode);
                origJson({ error: message, code, requestId: req.requestId });
              }
            });
            return res;
          }
          return origJson(body);
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  });
  app2.use(attachUser);
  app2.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      database: storeRepo.getStorageStatus(),
      mediaStorage: s3MediaService.getStatus(),
      traffic: trafficGuard.concurrency.getStats(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app2.get("/api/store/bootstrap", (req, res) => {
    const stateVersion = storeRepo.getStateVersion();
    if (stateVersion !== lastBootstrapStateVersion) {
      bootstrapCache.invalidate();
      lastBootstrapStateVersion = stateVersion;
    }
    let entry = bootstrapCache.get();
    if (!entry) {
      const state = storeRepo.getState();
      const nowMs = Date.now();
      entry = bootstrapCache.set(
        {
          products: state.products.filter((p) => p.active),
          settings: state.settings,
          coupons: state.coupons.filter((c) => c.active),
          promotions: getActivePromotions(state.promotions, nowMs),
          labReports: state.labReports,
          cmsSections: state.cmsSections.filter((s) => s.approvedByAdmin),
          serverNow: new Date(nowMs).toISOString()
        },
        nowMs
      );
    }
    res.setHeader(
      "Cache-Control",
      "public, max-age=15, s-maxage=30, stale-while-revalidate=60"
    );
    res.setHeader("ETag", entry.etag);
    if (req.headers["if-none-match"] === entry.etag) {
      return res.status(304).end();
    }
    res.type("application/json").send(entry.json);
  });
  app2.get("/api/auth/me", (req, res) => {
    if (!req.currentUser) {
      return res.json({ user: null });
    }
    res.json({ user: storeRepo.sanitizeUser(req.currentUser) });
  });
  app2.post("/api/auth/register", async (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: "Please enter your full name." });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!phone || !/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ""))) {
      return res.status(400).json({ error: "Please enter a valid 10-digit Indian mobile number." });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail === getAdminOwnerEmail()) {
      return res.status(403).json({ error: "This email is reserved for the store owner." });
    }
    try {
      const existing = await storeRepo.findUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(409).json({ error: "An account with this email already exists." });
      }
      const passwordHash = await hashPasswordAsync(password);
      const newUser = {
        id: `usr-${crypto6.randomUUID().slice(0, 8)}`,
        name: name.trim(),
        email: normalizedEmail,
        phone: phone.replace(/\D/g, ""),
        role: "customer",
        passwordHash,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        wishlistProductIds: []
      };
      const savedUser = await storeRepo.createUserIfNotExists(newUser);
      if (!savedUser) {
        return res.status(409).json({ error: "An account with this email already exists." });
      }
      const sessionToken = setSessionCookie(req, res, savedUser);
      return res.status(201).json({ user: storeRepo.sanitizeUser(savedUser), sessionToken });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message = err instanceof Error && err.message ? err.message : "Unable to create your account right now. Please try again shortly.";
      return res.status(statusCode).json({ error: message });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    try {
      const normalizedEmail = email.trim().toLowerCase();
      let user = await storeRepo.findUserByEmail(normalizedEmail);
      if (!user && normalizedEmail === getAdminOwnerEmail()) {
        await storeRepo.ensureLoaded({ forceRefresh: true });
        user = await storeRepo.findUserByEmail(normalizedEmail);
      }
      if (!user || !await verifyPasswordAsync(password, user.passwordHash)) {
        return res.status(401).json({ error: "Invalid email or password." });
      }
      const sessionToken = setSessionCookie(req, res, user);
      return res.json({ user: storeRepo.sanitizeUser(user), sessionToken });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message = err instanceof Error && err.message ? err.message : "Unable to sign in right now. Please try again shortly.";
      return res.status(statusCode).json({ error: message });
    }
  });
  app2.post("/api/auth/google", async (req, res) => {
    const { idToken } = req.body;
    if (!idToken || typeof idToken !== "string" || idToken.trim().length < 20) {
      return res.status(400).json({ error: "Valid Google sign-in token is required." });
    }
    try {
      const fbUser = await verifyFirebaseIdToken(idToken);
      const normalizedEmail = fbUser.email.trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(401).json({
          error: "Google account did not provide a verified email address."
        });
      }
      const existing = await storeRepo.findUserByEmail(normalizedEmail);
      const isOwner = normalizedEmail === getAdminOwnerEmail();
      const isNewAccount = !existing;
      const fallbackName = fbUser.displayName?.trim() || normalizedEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
      const userToSave = existing ? {
        ...existing,
        role: isOwner ? "admin" : existing.role
      } : {
        id: `usr-${crypto6.randomUUID().slice(0, 8)}`,
        name: fallbackName,
        email: normalizedEmail,
        phone: "",
        role: isOwner ? "admin" : "customer",
        passwordHash: await hashPasswordAsync(crypto6.randomBytes(24).toString("hex")),
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        wishlistProductIds: []
      };
      const savedUser = await storeRepo.upsertUser(userToSave, fbUser.localId);
      const sessionToken = setSessionCookie(req, res, savedUser);
      return res.json({
        user: storeRepo.sanitizeUser(savedUser),
        isNewAccount,
        sessionToken
      });
    } catch (err) {
      console.error("Google sign-in verification error:", err);
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 401;
      const message = err instanceof Error && err.message ? err.message : "Unable to complete Google sign-in right now. Please try again.";
      return res.status(statusCode).json({ error: message });
    }
  });
  app2.post("/api/auth/logout", (req, res) => {
    const secure = isHttpsRequest(req);
    res.clearCookie(SESSION_COOKIE, {
      path: "/",
      httpOnly: true,
      sameSite: secure ? "none" : "lax",
      secure
    });
    res.json({ ok: true });
  });
  app2.put("/api/auth/profile", requireAuth, async (req, res) => {
    const user = req.currentUser;
    const { name, phone, defaultAddress } = req.body;
    if (name && name.trim().length >= 2) user.name = name.trim();
    if (phone && /^[6-9]\d{9}$/.test(phone.replace(/\D/g, ""))) {
      user.phone = phone.replace(/\D/g, "");
    }
    if (defaultAddress) {
      user.defaultAddress = defaultAddress;
    }
    try {
      const savedUser = await storeRepo.upsertUser(user);
      return res.json({ user: storeRepo.sanitizeUser(savedUser) });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message = err instanceof Error && err.message ? err.message : "Unable to update your profile right now. Please try again.";
      return res.status(statusCode).json({ error: message });
    }
  });
  app2.post("/api/auth/wishlist", requireAuth, async (req, res) => {
    const user = req.currentUser;
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ error: "productId is required." });
    }
    const idx = user.wishlistProductIds.indexOf(productId);
    if (idx >= 0) {
      user.wishlistProductIds.splice(idx, 1);
    } else {
      user.wishlistProductIds.push(productId);
    }
    try {
      const savedUser = await storeRepo.upsertUser(user);
      return res.json({ wishlistProductIds: savedUser.wishlistProductIds });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message = err instanceof Error && err.message ? err.message : "Unable to update wishlist right now. Please try again.";
      return res.status(statusCode).json({ error: message });
    }
  });
  app2.post("/api/payments/create-order", async (req, res) => {
    const startedAt = Date.now();
    const { items, shippingSpeed, paymentMethod, couponCode } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Your cart is empty." });
    }
    if (paymentMethod === "COD") {
      return res.status(400).json({ error: "Cash on Delivery does not require an online payment order." });
    }
    const razorpayConfig = getRazorpayConfig();
    if (!razorpayConfig) {
      logStructured("error", "payments", "razorpay_credentials_missing", {
        requestId: req.requestId
      });
      return res.status(503).json({
        error: "Online payments are temporarily unavailable because Razorpay credentials are not configured on the server. Please use Cash on Delivery or try again later.",
        code: "RAZORPAY_NOT_CONFIGURED"
      });
    }
    try {
      const ctxStartedAt = Date.now();
      const ctx = await storeRepo.loadCheckoutContext();
      const contextMs = Date.now() - ctxStartedAt;
      for (const item of items) {
        const product = ctx.products.find((p) => p.id === item.productId && p.active);
        if (!product) {
          return res.status(400).json({ error: `Product ${item.productId} is unavailable.` });
        }
        if (item.quantity <= 0 || item.quantity > product.stock) {
          return res.status(400).json({
            error: `Only ${product.stock} unit(s) available for ${product.name}.`
          });
        }
      }
      const calc = calculateCartTotals(items, ctx.products, ctx.settings, {
        shippingSpeed,
        paymentMethod,
        couponCode,
        coupons: ctx.coupons,
        promotions: ctx.promotions,
        nowMs: Date.now()
      });
      const amountPaise = Math.round(calc.grandTotal * 100);
      if (!Number.isFinite(amountPaise) || amountPaise < 100) {
        return res.status(400).json({ error: "Invalid payable amount for online payment." });
      }
      const rzpStartedAt = Date.now();
      const orderCreation = await createRazorpayServerOrder({
        config: razorpayConfig,
        amountPaise,
        currency: "INR",
        receipt: `hr_${Date.now()}`,
        notes: { store: "HimRudra", method: paymentMethod || "UPI" }
      });
      const razorpayMs = Date.now() - rzpStartedAt;
      if (!orderCreation.ok) {
        logStructured("error", "payments", "razorpay_order_create_failed", {
          requestId: req.requestId,
          status: orderCreation.gatewayStatus,
          razorpayMs,
          error: orderCreation.message
        });
        return res.status(orderCreation.statusCode).json({
          error: orderCreation.message,
          code: "RAZORPAY_ORDER_CREATE_FAILED"
        });
      }
      const razorpayOrderId = orderCreation.razorpayOrderId;
      const dbWriteStartedAt = Date.now();
      await storeRepo.upsertPaymentIntent({
        razorpayOrderId,
        amountPaise,
        verified: false,
        signatureVerified: false,
        method: paymentMethod || "UPI",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      const dbWriteMs = Date.now() - dbWriteStartedAt;
      const totalMs = Date.now() - startedAt;
      res.setHeader(
        "Server-Timing",
        `context;dur=${contextMs}, razorpay;dur=${razorpayMs}, dbWrite;dur=${dbWriteMs}, total;dur=${totalMs}`
      );
      logStructured("info", "payments", "create_order_timing", {
        requestId: req.requestId,
        razorpayMode: razorpayConfig.mode,
        contextMs,
        razorpayMs,
        dbWriteMs,
        totalMs
      });
      res.json({
        razorpayOrderId,
        amountPaise,
        currency: "INR",
        keyId: razorpayConfig.keyId,
        mode: razorpayConfig.mode,
        liveGateway: true,
        calculation: calc
      });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message = err instanceof Error && err.message ? err.message : "Unable to initialize payment right now. Please try again.";
      logStructured("error", "payments", "create_order_failed", {
        requestId: req.requestId,
        durationMs: Date.now() - startedAt,
        error: message
      });
      return res.status(statusCode).json({ error: message, requestId: req.requestId });
    }
  });
  app2.post("/api/payments/verify", async (req, res) => {
    const startedAt = Date.now();
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const razorpayConfig = getRazorpayConfig();
    if (!razorpayConfig) {
      logStructured("error", "payments", "razorpay_credentials_missing_verify", {
        requestId: req.requestId
      });
      return res.status(503).json({
        error: "Online payment verification is unavailable because Razorpay credentials are not configured on the server.",
        code: "RAZORPAY_NOT_CONFIGURED"
      });
    }
    if (!isValidRazorpayOrderId(razorpayOrderId) || !isValidRazorpayPaymentId(razorpayPaymentId)) {
      return res.status(400).json({
        error: "Valid Razorpay order ID and payment ID are required.",
        code: "RAZORPAY_INVALID_REFERENCE"
      });
    }
    if (typeof razorpaySignature !== "string" || !razorpaySignature.trim()) {
      return res.status(400).json({
        error: "Payment signature is required for verification.",
        code: "RAZORPAY_SIGNATURE_MISSING"
      });
    }
    const cleanOrderId = razorpayOrderId.trim();
    const cleanPaymentId = razorpayPaymentId.trim();
    const cleanSignature = razorpaySignature.trim();
    try {
      const dbReadStartedAt = Date.now();
      const intent = await storeRepo.findPaymentIntent(cleanOrderId);
      const dbReadMs = Date.now() - dbReadStartedAt;
      if (!intent) {
        return res.status(404).json({
          error: "Payment session not found or expired.",
          code: "PAYMENT_SESSION_NOT_FOUND"
        });
      }
      const verifyStartedAt = Date.now();
      const signatureValid = verifyRazorpaySignature({
        razorpayOrderId: cleanOrderId,
        razorpayPaymentId: cleanPaymentId,
        razorpaySignature: cleanSignature,
        keySecret: razorpayConfig.keySecret
      });
      if (!signatureValid) {
        logStructured("warn", "payments", "signature_mismatch", {
          requestId: req.requestId,
          razorpayOrderId: cleanOrderId
        });
        return res.status(400).json({
          error: "Payment signature verification failed.",
          code: "RAZORPAY_SIGNATURE_INVALID"
        });
      }
      if (intent.verified && intent.paymentId && intent.paymentId !== cleanPaymentId) {
        return res.status(409).json({
          error: "This payment session has already been verified with a different transaction.",
          code: "PAYMENT_ALREADY_BOUND"
        });
      }
      const idempotent = Boolean(
        intent.verified && intent.signatureVerified && intent.paymentId === cleanPaymentId
      );
      let verifiedPaymentMethod = normalizeRazorpayPaymentMethod(intent.method);
      let razorpayApiMs = 0;
      let dbWriteMs = 0;
      if (!idempotent) {
        const apiStartedAt = Date.now();
        const apiCheck = await fetchAndVerifyCapturedRazorpayPayment({
          config: razorpayConfig,
          razorpayOrderId: cleanOrderId,
          razorpayPaymentId: cleanPaymentId,
          expectedAmountPaise: intent.amountPaise,
          expectedCurrency: "INR"
        });
        razorpayApiMs = Date.now() - apiStartedAt;
        if (!apiCheck.ok) {
          logStructured("warn", "payments", "razorpay_api_verification_failed", {
            requestId: req.requestId,
            razorpayOrderId: cleanOrderId,
            code: apiCheck.code,
            statusCode: apiCheck.statusCode,
            razorpayApiMs
          });
          return res.status(apiCheck.statusCode).json({
            error: apiCheck.message,
            code: apiCheck.code
          });
        }
        verifiedPaymentMethod = normalizeRazorpayPaymentMethod(
          apiCheck.payment.method,
          intent.method
        );
        const dbWriteStartedAt = Date.now();
        await storeRepo.upsertPaymentIntent({
          ...intent,
          method: verifiedPaymentMethod,
          verified: true,
          signatureVerified: true,
          paymentId: cleanPaymentId
        });
        dbWriteMs = Date.now() - dbWriteStartedAt;
      }
      const verifyMs = Date.now() - verifyStartedAt;
      const totalMs = Date.now() - startedAt;
      res.setHeader(
        "Server-Timing",
        `dbRead;dur=${dbReadMs}, verify;dur=${verifyMs}, razorpayApi;dur=${razorpayApiMs}, dbWrite;dur=${dbWriteMs}, total;dur=${totalMs}`
      );
      logStructured("info", "payments", "verify_timing", {
        requestId: req.requestId,
        idempotent,
        paymentMethod: verifiedPaymentMethod,
        dbReadMs,
        razorpayApiMs,
        verifyMs,
        dbWriteMs,
        totalMs
      });
      res.json({
        verified: true,
        idempotent,
        paymentMethod: verifiedPaymentMethod,
        razorpayOrderId: cleanOrderId,
        razorpayPaymentId: cleanPaymentId,
        verifiedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message = err instanceof Error && err.message ? err.message : "Unable to verify payment right now. Please try again.";
      logStructured("error", "payments", "verify_failed", {
        requestId: req.requestId,
        durationMs: Date.now() - startedAt,
        error: message
      });
      return res.status(statusCode).json({ error: message, requestId: req.requestId });
    }
  });
  app2.post("/api/payments/webhook", async (req, res) => {
    const signature = String(req.headers["x-razorpay-signature"] ?? "");
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      logStructured("error", "payments", "webhook_secret_missing", {
        requestId: req.requestId
      });
      return res.status(503).json({
        error: "RAZORPAY_WEBHOOK_SECRET is not configured on the server.",
        code: "RAZORPAY_WEBHOOK_NOT_CONFIGURED"
      });
    }
    const payloadToVerify = req.rawBody ?? JSON.stringify(req.body);
    if (!verifyRazorpayWebhookSignature({
      rawBody: payloadToVerify,
      signature,
      webhookSecret
    })) {
      logStructured("warn", "payments", "webhook_signature_invalid", {
        requestId: req.requestId
      });
      return res.status(400).json({ error: "Invalid webhook signature." });
    }
    const body = req.body;
    const event = String(body.event || "").trim();
    const paymentEntity = body.payload?.payment?.entity;
    const refundEntity = body.payload?.refund?.entity;
    const razorpayOrderId = body.razorpayOrderId || paymentEntity?.order_id;
    const razorpayPaymentId = body.razorpayPaymentId || paymentEntity?.id || refundEntity?.payment_id;
    const entityAmountPaise = typeof paymentEntity?.amount === "number" ? paymentEntity.amount : void 0;
    const entityCurrency = paymentEntity?.currency ? String(paymentEntity.currency).toUpperCase() : "INR";
    const state = storeRepo.getState();
    let intentReconciled = false;
    if ((event === "payment.captured" || event === "order.paid") && razorpayOrderId && razorpayPaymentId && entityCurrency === "INR") {
      const intent = await storeRepo.findPaymentIntent(razorpayOrderId).catch(() => null);
      if (intent && (entityAmountPaise === void 0 || entityAmountPaise === intent.amountPaise) && (!intent.paymentId || intent.paymentId === razorpayPaymentId)) {
        const reconciledMethod = normalizeRazorpayPaymentMethod(
          paymentEntity?.method,
          intent.method
        );
        if (!intent.verified || !intent.signatureVerified || intent.method !== reconciledMethod) {
          await storeRepo.upsertPaymentIntent({
            ...intent,
            method: reconciledMethod,
            verified: true,
            signatureVerified: true,
            paymentId: razorpayPaymentId
          });
          intentReconciled = true;
        }
      }
    }
    const order = state.orders.find(
      (o) => razorpayOrderId && o.razorpayOrderId === razorpayOrderId || razorpayPaymentId && o.razorpayPaymentId === razorpayPaymentId
    );
    if (!order) {
      return res.json({ received: true, matched: false, intentReconciled });
    }
    const expectedOrderPaise = Math.round(order.totalAmount * 100);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let orderUpdated = false;
    if (event === "payment.captured" || event === "order.paid") {
      if (entityCurrency !== "INR" || entityAmountPaise !== void 0 && entityAmountPaise !== expectedOrderPaise) {
        logStructured("warn", "payments", "webhook_amount_or_currency_mismatch", {
          requestId: req.requestId,
          orderNumber: order.orderNumber,
          entityCurrency
        });
        return res.status(400).json({ error: "Webhook payment amount or currency mismatch." });
      }
      if (order.paymentStatus !== "Paid") {
        const verifiedMethod = normalizeRazorpayPaymentMethod(
          paymentEntity?.method,
          order.paymentMethod
        );
        order.paymentStatus = "Paid";
        order.paymentMethod = verifiedMethod;
        if (razorpayPaymentId) order.razorpayPaymentId = razorpayPaymentId;
        order.paymentVerifiedAt = nowIso;
        if (order.status === "Pending Payment") {
          order.status = "Payment Confirmed";
        }
        order.timeline.push({
          status: "Payment Confirmed",
          timestamp: nowIso,
          note: `Webhook verified ${verifiedMethod} payment (${razorpayPaymentId || order.razorpayPaymentId || "Gateway"})`
        });
        if (!state.adminNotifications.some(
          (n) => n.orderId === order.id && n.type === "new_paid_order"
        )) {
          state.adminNotifications.unshift({
            id: `notif-${crypto6.randomUUID().slice(0, 8)}`,
            type: "new_paid_order",
            title: "New Paid Order Received!",
            message: `${order.orderNumber} from ${order.customerName} (\u20B9${order.totalAmount})`,
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            amount: order.totalAmount,
            read: false,
            emailNotifiedTo: state.settings.emailNotificationsEnabled ? state.settings.orderNotificationEmail : void 0,
            createdAt: nowIso
          });
        }
        orderUpdated = true;
      }
    } else if (event === "payment.failed") {
      if (order.paymentStatus === "Pending Payment") {
        order.paymentStatus = "Failed";
        order.timeline.push({
          status: order.status,
          timestamp: nowIso,
          note: `Razorpay webhook reported payment failed (${razorpayPaymentId || "Gateway"})`
        });
        orderUpdated = true;
      }
    } else if (event === "refund.processed") {
      if (order.paymentStatus !== "Refunded") {
        const prevStatus = order.status;
        order.paymentStatus = "Refunded";
        order.status = "Refunded";
        if (typeof refundEntity?.amount === "number" && refundEntity.amount > 0) {
          order.refundAmount = Math.round(refundEntity.amount) / 100;
        } else if (order.refundAmount === void 0) {
          order.refundAmount = order.totalAmount;
        }
        if (prevStatus !== "Cancelled" && prevStatus !== "Refunded") {
          for (const item of order.items) {
            const prod = state.products.find((p) => p.id === item.productId);
            if (prod) {
              prod.stock += item.quantity;
            }
          }
        }
        order.timeline.push({
          status: "Refunded",
          timestamp: nowIso,
          note: `Razorpay webhook confirmed refund (${refundEntity?.id || "Gateway"})`
        });
        orderUpdated = true;
      }
    }
    if (orderUpdated) {
      storeRepo.commit();
    }
    res.json({
      received: true,
      matched: true,
      intentReconciled,
      orderUpdated,
      orderNumber: order.orderNumber
    });
  });
  app2.post("/api/orders", async (req, res) => {
    const startedAt = Date.now();
    const {
      items,
      shippingAddress,
      deliveryInstructions,
      shippingSpeed = "standard",
      paymentMethod = "UPI",
      couponCode,
      razorpayOrderId,
      razorpayPaymentId
    } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cannot place an empty order." });
    }
    if (!shippingAddress) {
      return res.status(400).json({ error: "Shipping address is required." });
    }
    const validation = validateCheckoutForm(shippingAddress);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Please check your shipping details.",
        fieldErrors: validation.errors
      });
    }
    const isOnline = paymentMethod !== "COD";
    const isPostgres = storeRepo.isPostgresEnabled();
    let ctx;
    let contextMs = 0;
    try {
      const ctxStartedAt = Date.now();
      ctx = await storeRepo.loadCheckoutContext({
        razorpayOrderId: isOnline ? razorpayOrderId : void 0,
        razorpayPaymentId: isOnline ? razorpayPaymentId : void 0,
        includeOrderSequence: true
      });
      contextMs = Date.now() - ctxStartedAt;
    } catch (err) {
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const message = err instanceof Error && err.message ? err.message : "Unable to load checkout details right now. Please try again.";
      return res.status(statusCode).json({ error: message, requestId: req.requestId });
    }
    if (isOnline && ctx.existingOrderByPayment) {
      const totalMs = Date.now() - startedAt;
      res.setHeader("Server-Timing", `context;dur=${contextMs}, total;dur=${totalMs}`);
      logStructured("info", "orders", "create_order_timing", {
        requestId: req.requestId,
        orderNumber: ctx.existingOrderByPayment.orderNumber,
        paymentMethod,
        idempotent: true,
        contextMs,
        txMs: 0,
        totalMs
      });
      return res.status(200).json({
        order: ctx.existingOrderByPayment,
        updatedProducts: ctx.products.filter((p) => p.active),
        idempotent: true
      });
    }
    const orderItems = [];
    const stockDecrements = [];
    for (const item of items) {
      const product = ctx.products.find((p) => p.id === item.productId && p.active);
      if (!product) {
        return res.status(400).json({ error: `Product not found: ${item.productId}` });
      }
      if (item.quantity < 1 || item.quantity > product.stock) {
        return res.status(400).json({
          error: `Insufficient inventory for ${product.name}. Remaining stock: ${product.stock}.`
        });
      }
      orderItems.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        netQuantity: product.netQuantity,
        quantity: item.quantity,
        unitPrice: product.price,
        unitMrp: product.mrp,
        unitCost: product.costPerUnit,
        batchNumber: product.batchNumber
      });
      stockDecrements.push({ productId: product.id, quantity: item.quantity });
    }
    const nowMs = Date.now();
    const calc = calculateCartTotals(items, ctx.products, ctx.settings, {
      shippingSpeed,
      paymentMethod,
      couponCode,
      coupons: ctx.coupons,
      promotions: ctx.promotions,
      nowMs
    });
    if (isOnline) {
      const intent = ctx.paymentIntent;
      if (!intent || !intent.verified || !intent.signatureVerified || !razorpayOrderId || !razorpayPaymentId || intent.razorpayOrderId !== razorpayOrderId || intent.paymentId !== razorpayPaymentId || intent.amountPaise !== Math.round(calc.grandTotal * 100)) {
        return res.status(402).json({
          error: "Payment verification is required before confirming your order."
        });
      }
    }
    const resolvedPaymentMethod = isOnline ? normalizeRazorpayPaymentMethod(ctx.paymentIntent?.method, paymentMethod) : "COD";
    const now = new Date(nowMs);
    const deliveryDays = shippingSpeed === "express" ? 2 : 5;
    const estDate = new Date(now.getTime() + deliveryDays * 864e5).toISOString().slice(0, 10);
    let nextOrderSeq = ctx.maxOrderSeq + 1;
    const buildOrderNumber = (seq) => `HIM-2026-${String(seq).padStart(4, "0")}`;
    const orderNumber = buildOrderNumber(nextOrderSeq);
    const initialStatus = isOnline ? "Payment Confirmed" : "Processing";
    const timeline = [
      {
        status: "Pending Payment",
        timestamp: now.toISOString(),
        note: `Order created (${resolvedPaymentMethod})`
      }
    ];
    if (isOnline) {
      timeline.push({
        status: "Payment Confirmed",
        timestamp: now.toISOString(),
        note: `Server-verified ${resolvedPaymentMethod} payment (${razorpayPaymentId})`
      });
    } else {
      timeline.push({
        status: "Processing",
        timestamp: now.toISOString(),
        note: "Cash on Delivery order queued for packing"
      });
    }
    const gatewayFeePct = ctx.settings.gatewayFeePercent ?? 2;
    const gatewayFeeAmount = isOnline ? Math.round(calc.grandTotal * (gatewayFeePct / 100) * 100) / 100 : 0;
    const actualShippingCost = ctx.settings.defaultShippingCostPerOrder ?? 65;
    const newOrder = {
      id: `ord-${crypto6.randomUUID().slice(0, 8)}`,
      orderNumber,
      userId: req.currentUser?.id,
      customerName: shippingAddress.fullName.trim(),
      customerEmail: shippingAddress.email.trim().toLowerCase(),
      customerPhone: shippingAddress.phone.replace(/\D/g, ""),
      shippingAddress: {
        ...shippingAddress,
        houseFlatNumber: shippingAddress.houseFlatNumber?.trim() || void 0,
        landmark: shippingAddress.landmark?.trim() || void 0,
        phone: shippingAddress.phone.replace(/\D/g, ""),
        pincode: shippingAddress.pincode.trim()
      },
      deliveryInstructions: deliveryInstructions?.trim() || void 0,
      items: orderItems,
      subtotal: calc.subtotal,
      mrpTotal: calc.mrpTotal,
      instantSavings: calc.instantSavings,
      couponCode: calc.appliedCoupon?.code,
      couponDiscount: calc.couponDiscount,
      promotionId: calc.appliedPromotion?.id,
      promotionTitle: calc.appliedPromotion?.title,
      shippingFee: calc.shippingFee,
      shippingSpeed,
      codFee: calc.codFee,
      taxableValue: calc.taxableValue,
      gstAmount: calc.gstAmount,
      totalAmount: calc.grandTotal,
      gatewayFeeAmount,
      actualShippingCost,
      paymentMethod: resolvedPaymentMethod,
      paymentStatus: isOnline ? "Paid" : "Pending COD",
      razorpayOrderId: isOnline ? razorpayOrderId : void 0,
      razorpayPaymentId: isOnline ? razorpayPaymentId : void 0,
      paymentVerifiedAt: isOnline ? now.toISOString() : void 0,
      status: initialStatus,
      estimatedDelivery: estDate,
      timeline,
      createdAt: now.toISOString()
    };
    const promotionUpdate = calc.appliedPromotion ? { promotionId: calc.appliedPromotion.id, revenueDelta: calc.grandTotal } : void 0;
    const adminNotification = isOnline ? {
      id: `notif-${crypto6.randomUUID().slice(0, 8)}`,
      type: "new_paid_order",
      title: "New Paid Order Received!",
      message: `${newOrder.orderNumber} from ${newOrder.customerName} (\u20B9${newOrder.totalAmount})`,
      orderId: newOrder.id,
      orderNumber: newOrder.orderNumber,
      customerName: newOrder.customerName,
      amount: newOrder.totalAmount,
      read: false,
      emailNotifiedTo: ctx.settings.emailNotificationsEnabled ? ctx.settings.orderNotificationEmail : void 0,
      createdAt: now.toISOString()
    } : void 0;
    const hadDefaultAddress = Boolean(req.currentUser?.defaultAddress);
    const userDefaultAddressUpdate = req.currentUser && !hadDefaultAddress ? { userId: req.currentUser.id, address: newOrder.shippingAddress } : void 0;
    const state = storeRepo.getState();
    const stockSnapshots = /* @__PURE__ */ new Map();
    const appliedPromoInState = calc.appliedPromotion ? state.promotions.find((p) => p.id === calc.appliedPromotion.id) : void 0;
    const prevPromoUsage = appliedPromoInState?.usageCount;
    const prevPromoRevenue = appliedPromoInState?.revenueGenerated;
    if (!isPostgres) {
      for (const dec of stockDecrements) {
        const product = state.products.find((p) => p.id === dec.productId);
        if (product) {
          stockSnapshots.set(product.id, product.stock);
          product.stock = Math.max(0, product.stock - dec.quantity);
        }
      }
      if (appliedPromoInState) {
        appliedPromoInState.usageCount += 1;
        appliedPromoInState.revenueGenerated += calc.grandTotal;
      }
      state.orders.unshift(newOrder);
      if (adminNotification) {
        state.adminNotifications.unshift(adminNotification);
      }
      if (req.currentUser && !hadDefaultAddress) {
        req.currentUser.defaultAddress = newOrder.shippingAddress;
      }
    }
    const txStartedAt = Date.now();
    try {
      let commitResult = {};
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          commitResult = await storeRepo.commitOrderAtomic(newOrder, stockDecrements, {
            promotionUpdate,
            adminNotification,
            userDefaultAddressUpdate
          });
          break;
        } catch (attemptErr) {
          if (isPostgres && attempt < 2 && attemptErr instanceof StorePersistenceError && attemptErr.code === "ORDER_NUMBER_CONFLICT") {
            nextOrderSeq += 1;
            newOrder.orderNumber = buildOrderNumber(nextOrderSeq);
            if (adminNotification) {
              adminNotification.orderNumber = newOrder.orderNumber;
              adminNotification.message = `${newOrder.orderNumber} from ${newOrder.customerName} (\u20B9${newOrder.totalAmount})`;
            }
            continue;
          }
          throw attemptErr;
        }
      }
      const txMs = Date.now() - txStartedAt;
      const totalMs = Date.now() - startedAt;
      if (commitResult.existingOrder) {
        res.setHeader(
          "Server-Timing",
          `context;dur=${contextMs}, tx;dur=${txMs}, total;dur=${totalMs}`
        );
        logStructured("info", "orders", "create_order_timing", {
          requestId: req.requestId,
          orderNumber: commitResult.existingOrder.orderNumber,
          paymentMethod,
          idempotent: true,
          contextMs,
          txMs,
          totalMs
        });
        return res.status(200).json({
          order: commitResult.existingOrder,
          updatedProducts: ctx.products.filter((p) => p.active),
          idempotent: true
        });
      }
      if (isPostgres) {
        if (commitResult.updatedProducts) {
          for (const upd of commitResult.updatedProducts) {
            const p = ctx.products.find((prod) => prod.id === upd.id);
            if (p) p.stock = upd.stock;
          }
        }
        if (appliedPromoInState) {
          appliedPromoInState.usageCount += 1;
          appliedPromoInState.revenueGenerated += calc.grandTotal;
        }
        if (req.currentUser && !hadDefaultAddress) {
          req.currentUser.defaultAddress = newOrder.shippingAddress;
        }
      }
      res.setHeader(
        "Server-Timing",
        `context;dur=${contextMs}, tx;dur=${txMs}, total;dur=${totalMs}`
      );
      logStructured("info", "orders", "create_order_timing", {
        requestId: req.requestId,
        orderNumber: newOrder.orderNumber,
        paymentMethod,
        idempotent: false,
        contextMs,
        txMs,
        totalMs
      });
      const updatedProductsList = isPostgres ? ctx.products.filter((p) => p.active) : state.products.filter((p) => p.active);
      return res.status(201).json({ order: newOrder, updatedProducts: updatedProductsList });
    } catch (err) {
      if (!isPostgres) {
        state.orders = state.orders.filter((o) => o.id !== newOrder.id);
        if (adminNotification) {
          state.adminNotifications = state.adminNotifications.filter(
            (n) => n.id !== adminNotification.id
          );
        }
        for (const [prodId, prevStock] of stockSnapshots.entries()) {
          const product = state.products.find((p) => p.id === prodId);
          if (product) product.stock = prevStock;
        }
        if (appliedPromoInState && prevPromoUsage !== void 0 && prevPromoRevenue !== void 0) {
          appliedPromoInState.usageCount = prevPromoUsage;
          appliedPromoInState.revenueGenerated = prevPromoRevenue;
        }
        if (req.currentUser && !hadDefaultAddress) {
          req.currentUser.defaultAddress = void 0;
        }
      }
      const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
      const code = err instanceof StorePersistenceError ? err.code : "ORDER_COMMIT_FAILED";
      const message = err instanceof Error ? err.message : "Unable to confirm your order right now. Please retry.";
      logStructured("error", "orders", "atomic_commit_failed", {
        requestId: req.requestId,
        orderNumber: newOrder.orderNumber,
        code,
        statusCode,
        durationMs: Date.now() - startedAt,
        error: message
      });
      return res.status(statusCode).json({ error: message, code, requestId: req.requestId });
    }
  });
  app2.get("/api/orders/mine", requireAuth, (req, res) => {
    const user = req.currentUser;
    const orders2 = storeRepo.getState().orders.filter(
      (o) => o.userId === user.id || o.customerEmail.toLowerCase() === user.email.toLowerCase()
    );
    res.json({ orders: orders2 });
  });
  app2.get("/api/orders/track", (req, res) => {
    const orderNumber = String(req.query.orderNumber ?? "").trim().toUpperCase();
    const contact = String(req.query.contact ?? "").trim().toLowerCase();
    if (!orderNumber) {
      return res.status(400).json({ error: "Order number is required." });
    }
    const order = storeRepo.getState().orders.find((o) => o.orderNumber.toUpperCase() === orderNumber);
    if (!order) {
      return res.status(404).json({ error: `No order found matching ${orderNumber}.` });
    }
    const isOwnerOrAdmin = Boolean(
      req.currentUser && (isAuthorizedAdmin(req.currentUser, getAdminOwnerEmail()) || order.userId === req.currentUser.id || order.customerEmail.toLowerCase() === req.currentUser.email.toLowerCase())
    );
    if (!isOwnerOrAdmin) {
      if (!contact) {
        return res.status(400).json({
          error: "Enter the email address or 10-digit mobile number used for this order."
        });
      }
      const cleanPhone = contact.replace(/\D/g, "");
      const orderPhoneDigits = order.customerPhone.replace(/\D/g, "");
      const matchesEmail = order.customerEmail.toLowerCase() === contact;
      const matchesPhone = cleanPhone.length === 10 && orderPhoneDigits.length >= 10 && orderPhoneDigits.slice(-10) === cleanPhone;
      if (!matchesEmail && !matchesPhone) {
        return res.status(403).json({
          error: "The email or phone number does not match this order record."
        });
      }
    }
    res.json({ order });
  });
  app2.get("/api/lab-reports/:id/download", async (req, res) => {
    const state = storeRepo.getState();
    const report = req.params.id === "latest" ? state.labReports[0] : state.labReports.find((r) => r.id === req.params.id);
    if (!report) {
      return res.status(404).json({ error: "Laboratory report not found." });
    }
    const safeBatch = report.testedBatchNumber.replace(/[^a-zA-Z0-9_-]/g, "_") || "batch";
    res.setHeader("Cache-Control", "public, max-age=300");
    if (report.customDocumentUrl && /^https?:\/\//i.test(report.customDocumentUrl)) {
      if (s3MediaService.isEnabled()) {
        try {
          const obj = await s3MediaService.fetchObjectByUrl(report.customDocumentUrl);
          if (obj) {
            const ext = obj.contentType === "application/pdf" ? ".pdf" : obj.contentType === "image/png" ? ".png" : obj.contentType === "image/webp" ? ".webp" : ".jpg";
            const downloadName = report.originalFileName || `HimRudra-Lab-Certified-Batch-${safeBatch}${ext}`;
            res.setHeader("Content-Type", obj.contentType);
            res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
            return res.send(obj.buffer);
          }
        } catch (err) {
          logStructured("warn", "aws-s3", "lab_report_stream_fallback", {
            reportId: report.id,
            error: err instanceof Error ? err.message : "S3 stream error"
          });
        }
      }
      return res.redirect(302, report.customDocumentUrl);
    }
    if (report.customDocumentUrl?.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(report.customDocumentUrl);
      if (match) {
        const mime = match[1];
        const buffer = Buffer.from(match[2], "base64");
        const ext = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
        const downloadName = report.originalFileName || `HimRudra-Lab-Certified-Batch-${safeBatch}${ext}`;
        res.setHeader("Content-Type", mime);
        res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
        return res.send(buffer);
      }
    }
    if (report.customDocumentUrl && !/^https?:\/\//i.test(report.customDocumentUrl)) {
      const publicRoot = path2.resolve(process.cwd(), "public");
      const tmpUploadsRoot = path2.join(os2.tmpdir(), "himrudra-uploads");
      const relativeDocPath = report.customDocumentUrl.replace(/^\/+/, "");
      const candidatePaths = [
        { root: publicRoot, file: path2.resolve(publicRoot, relativeDocPath) },
        {
          root: tmpUploadsRoot,
          file: path2.resolve(tmpUploadsRoot, relativeDocPath.replace(/^uploads\/+/, ""))
        }
      ];
      for (const { root, file } of candidatePaths) {
        if ((file === root || file.startsWith(root + path2.sep)) && fs2.existsSync(file) && fs2.statSync(file).isFile()) {
          const ext = path2.extname(file) || ".jpeg";
          const downloadName = report.originalFileName || `HimRudra-Lab-Certified-Batch-${safeBatch}${ext}`;
          return res.download(file, downloadName);
        }
      }
    }
    const lines = [
      "HIMRUDRA \u2014 PURE BY HIMALAYAS",
      "LABORATORY CERTIFICATION & BATCH ANALYSIS REPORT",
      "============================================================",
      `Laboratory      : ${report.laboratoryName}`,
      `Report Number   : ${report.reportNumber}`,
      `Batch Code      : ${report.testedBatchNumber}`,
      `Test Date       : ${report.testDate}`,
      `Status          : ${report.verifiedStatus}`,
      `Methodology     : ${report.testingMethodology}`,
      "",
      "HEAVY METAL & ASSAY PARAMETERS",
      "------------------------------------------------------------",
      ...report.heavyMetals.map(
        (m) => `- ${m.parameter} (${m.method}): ${m.observedResult} | Limit: ${m.specificationLimit} | ${m.status}`
      ),
      "",
      "MICROBIOLOGICAL SCREENING PARAMETERS",
      "------------------------------------------------------------",
      ...report.microbiological.map(
        (m) => `- ${m.parameter} (${m.method}): ${m.observedResult} | Limit: ${m.limit} | ${m.status}`
      ),
      "",
      "NOTES",
      "------------------------------------------------------------",
      report.notes,
      ""
    ];
    const textContent = lines.join("\n");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="HimRudra-Lab-Certified-Batch-${safeBatch}.txt"`
    );
    return res.send(textContent);
  });
  app2.post("/api/inquiries", (req, res) => {
    const { name, email, phone, subject, message } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: "Please enter your name." });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!message || message.trim().length < 8) {
      return res.status(400).json({ error: "Please enter a brief message (at least 8 characters)." });
    }
    const inquiry = {
      id: `inq-${crypto6.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim(),
      subject: subject?.trim() || "General Storefront Inquiry",
      message: message.trim(),
      status: "New",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    storeRepo.getState().inquiries.unshift(inquiry);
    storeRepo.commit();
    res.status(201).json({ inquiry });
  });
  app2.post("/api/chat", async (req, res) => {
    const { message, language = "English", history = [] } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Please type a message." });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      return res.status(503).json({
        error: "AI concierge is unavailable because GEMINI_API_KEY is not configured in environment secrets."
      });
    }
    const state = storeRepo.getState();
    const productContext = state.products.filter((p) => p.active).map(
      (p) => `- ${p.name} (${p.netQuantity}): Selling Price \u20B9${p.price} (MRP \u20B9${p.mrp}), Stock: ${p.stock} units, Batch: ${p.batchNumber}. Usage: ${p.usageGuidance} Storage: ${p.storageInstructions}`
    ).join("\n");
    const cmsContext = state.cmsSections.filter((s) => s.approvedByAdmin).map((s) => `[${s.title}]: ${s.content}`).join("\n");
    const labContext = state.labReports.map(
      (r) => `Batch ${r.testedBatchNumber} | Lab: ${r.laboratoryName} | Report #: ${r.reportNumber} | Date: ${r.testDate} | Status: ${r.verifiedStatus} | Notes: ${r.notes}`
    ).join("\n");
    const activePromoList = getActivePromotions(state.promotions, Date.now());
    const promoContext = activePromoList.length ? activePromoList.map((pr) => `${pr.title}: ${pr.bannerHeadline} (ends ${pr.endsAt})`).join("; ") : "No active limited-time promotion.";
    const systemInstruction = `You are the official HimRudra Concierge ("HimRudra \u2014 Pure by Himalayas").
Answer politely, concisely, and accurately in ${language} (if the user writes in Hindi, Hinglish, or another Indian language, reply naturally in that language).
Strictly ground every answer in the verified store knowledge below. NEVER invent certifications, medical cure claims, or competing brands. Remind customers when relevant that HimRudra Shilajit Resin is a traditional wellness product and not intended to diagnose, treat, cure, or prevent any disease.

CONTACT & REGISTERED MARKETING OFFICE:
- Email: ${state.settings.brandEmail}
- Mobile: ${state.settings.brandPhone}
- Address: ${state.settings.brandAddress}

PRODUCTS & LIVE INVENTORY:
${productContext}

ACTIVE PROMOTIONS:
${promoContext}

SHIPPING & POLICY:
- Standard shipping: \u20B9${state.settings.standardShippingFee}${state.settings.freeShippingThreshold > 0 ? ` (free on orders \u20B9${state.settings.freeShippingThreshold}+ unless waived by an active free-shipping promotion)` : " (automatically waived to \u20B90 while the Limited-Time Free Shipping Offer is active; \u20B9100 delivery applies automatically after the offer ends)"}.
- Express shipping: \u20B9${state.settings.expressShippingFee}.
- Cash on Delivery (COD) fee: \u20B9${state.settings.codFee}.
- Active coupons: ${state.coupons.filter((c) => c.active).map((c) => `${c.code} (${c.description})`).join(", ")}.

ADMIN-APPROVED KNOWLEDGE & FAQS:
${cmsContext}

QUALITY & LAB DOCUMENTATION:
${labContext}`;
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const conversationText = history.slice(-6).map((m) => `${m.role === "user" ? "Customer" : "Concierge"}: ${m.content}`).join("\n");
      const prompt = conversationText ? `${conversationText}
Customer: ${message.trim()}
Concierge:` : message.trim();
      let response;
      try {
        response = await ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: prompt,
          config: {
            systemInstruction
          }
        });
      } catch (primaryErr) {
        const primaryMsg = primaryErr instanceof Error ? primaryErr.message : "";
        if (primaryMsg.includes("503") || primaryMsg.includes("UNAVAILABLE")) {
          response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            contents: prompt,
            config: {
              systemInstruction
            }
          });
        } else {
          throw primaryErr;
        }
      }
      const reply = response.text?.trim();
      if (!reply) {
        return res.status(502).json({ error: "Received an empty response from AI concierge." });
      }
      res.json({ reply });
    } catch (err) {
      console.error("Gemini chat error:", err);
      const raw = err instanceof Error ? err.message : "";
      const isBusy = raw.includes("503") || raw.includes("UNAVAILABLE");
      res.status(isBusy ? 503 : 500).json({
        error: isBusy ? "The AI concierge is experiencing high demand right now. Please try again in a moment, or reach himrudraofficial@gmail.com." : "Unable to reach AI support service right now. Please try again shortly."
      });
    }
  });
  app2.get("/api/admin/overview", requireAdmin, (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const state = storeRepo.getState();
    const nowMs = Date.now();
    const analytics = calculateProfitMetrics(state.orders, state.expenses, {
      gatewayFeePercent: state.settings.gatewayFeePercent,
      defaultShippingCostPerOrder: state.settings.defaultShippingCostPerOrder,
      nowMs
    });
    res.json({
      products: state.products,
      settings: state.settings,
      coupons: state.coupons,
      promotions: state.promotions,
      orders: state.orders,
      labReports: state.labReports,
      cmsSections: state.cmsSections,
      expenses: state.expenses,
      inquiries: state.inquiries,
      notifications: state.adminNotifications,
      customers: state.users.map((u) => storeRepo.sanitizeUser(u)),
      analytics,
      serverNow: new Date(nowMs).toISOString()
    });
  });
  app2.post("/api/admin/products", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const body = req.body;
    if (!body.name?.trim()) {
      return res.status(400).json({ error: "Product name is required." });
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "Valid selling price is required." });
    }
    const mrp = Math.max(price, Number(body.mrp) || price);
    const costPerUnit = Math.max(0, Number(body.costPerUnit) || Math.round(price * 0.35));
    const stock = Math.max(0, Math.floor(Number(body.stock) || 0));
    const lowStockThreshold = Math.max(0, Math.floor(Number(body.lowStockThreshold) || 10));
    const netQuantity = body.netQuantity?.trim() || "20 g";
    const batchNumber = body.batchNumber?.trim() || `HR-BATCH-${(/* @__PURE__ */ new Date()).getFullYear()}`;
    const gstRatePercent = Math.max(0, Math.min(28, Number(body.gstRatePercent ?? 12)));
    const slugBase = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const uniqueSuffix = crypto6.randomUUID().slice(0, 6);
    const id = `${slugBase || "himrudra-product"}-${uniqueSuffix}`;
    const sku = body.sku?.trim().toUpperCase() || `HR-${slugBase.replace(/-/g, "").slice(0, 6).toUpperCase() || "PRD"}-${uniqueSuffix.slice(0, 4).toUpperCase()}`;
    const customImages = Array.isArray(body.customImages) ? body.customImages.filter((u) => typeof u === "string" && u.trim().length > 0) : [];
    const newProduct = {
      id,
      slug: id,
      name: body.name.trim(),
      subtitle: body.subtitle?.trim() || `Pure by Himalayas \xB7 ${netQuantity}`,
      netQuantity,
      sku,
      hsnCode: body.hsnCode?.trim() || "30049011",
      mrp,
      price,
      costPerUnit,
      stock,
      lowStockThreshold,
      batchNumber,
      gstRatePercent,
      shortDescription: body.shortDescription?.trim() || "Carefully crafted Himalayan wellness formulation presented with batch-level lab transparency.",
      usageGuidance: body.usageGuidance?.trim() || "Use as directed on the jar label or as advised by a qualified wellness practitioner.",
      storageInstructions: body.storageInstructions?.trim() || "Keep tightly sealed in a cool, dry place away from direct sunlight.",
      shippingNote: body.shippingNote?.trim() || (state.settings.freeShippingThreshold > 0 ? `Standard pan-India shipping is \u20B9${state.settings.standardShippingFee} (free on orders \u20B9${state.settings.freeShippingThreshold}+).` : `Free standard delivery during our limited-time offer; standard delivery is \u20B9${state.settings.standardShippingFee} after the offer ends. Cash on Delivery fee is \u20B9${state.settings.codFee}.`),
      returnPolicy: body.returnPolicy?.trim() || "Unopened, tamper-sealed packages are eligible for return or replacement within 7 days of delivery.",
      specifications: [
        { label: "Net Quantity", value: netQuantity },
        { label: "SKU", value: sku },
        { label: "Active Batch Code", value: batchNumber },
        { label: "GST Rate", value: `${gstRatePercent}% (Included)` }
      ],
      galleryTypes: ["hero"],
      customImages: customImages.length ? customImages : ["/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg"],
      active: body.active !== false
    };
    state.products.push(newProduct);
    storeRepo.commit();
    res.status(201).json({ product: newProduct, products: state.products });
  });
  app2.put("/api/admin/products/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const product = state.products.find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found." });
    const {
      name,
      subtitle,
      netQuantity,
      sku,
      price,
      mrp,
      costPerUnit,
      stock,
      lowStockThreshold,
      batchNumber,
      active,
      shortDescription,
      usageGuidance,
      storageInstructions,
      customImages
    } = req.body;
    if (typeof name === "string" && name.trim()) product.name = name.trim();
    if (typeof subtitle === "string" && subtitle.trim()) product.subtitle = subtitle.trim();
    if (typeof netQuantity === "string" && netQuantity.trim()) product.netQuantity = netQuantity.trim();
    if (typeof sku === "string" && sku.trim()) product.sku = sku.trim().toUpperCase();
    if (typeof price === "number" && price > 0) product.price = price;
    if (typeof mrp === "number" && mrp > 0) product.mrp = mrp;
    if (typeof costPerUnit === "number" && costPerUnit >= 0) product.costPerUnit = costPerUnit;
    if (typeof stock === "number" && stock >= 0) product.stock = Math.floor(stock);
    if (typeof lowStockThreshold === "number" && lowStockThreshold >= 0) {
      product.lowStockThreshold = Math.floor(lowStockThreshold);
    }
    if (typeof batchNumber === "string" && batchNumber.trim()) {
      product.batchNumber = batchNumber.trim();
    }
    if (typeof active === "boolean") product.active = active;
    if (typeof shortDescription === "string" && shortDescription.trim()) {
      product.shortDescription = shortDescription.trim();
    }
    if (typeof usageGuidance === "string" && usageGuidance.trim()) {
      product.usageGuidance = usageGuidance.trim();
    }
    if (typeof storageInstructions === "string" && storageInstructions.trim()) {
      product.storageInstructions = storageInstructions.trim();
    }
    if (Array.isArray(customImages) && customImages.length > 0) {
      product.customImages = customImages.filter(
        (u) => typeof u === "string" && u.trim().length > 0
      );
    }
    storeRepo.commit();
    res.json({ product });
  });
  app2.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    if (state.products.length <= 1) {
      return res.status(400).json({ error: "At least one product must remain in the catalog." });
    }
    const before = state.products.length;
    state.products = state.products.filter((p) => p.id !== req.params.id);
    if (state.products.length === before) {
      return res.status(404).json({ error: "Product not found." });
    }
    storeRepo.commit();
    res.json({ ok: true, products: state.products });
  });
  app2.put("/api/admin/settings", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const patch = { ...req.body };
    const nonNegativeIntKeys = [
      "standardShippingFee",
      "expressShippingFee",
      "freeShippingThreshold",
      "codFee",
      "defaultShippingCostPerOrder"
    ];
    for (const key of nonNegativeIntKeys) {
      if (key in patch) {
        const raw = patch[key];
        if (raw === null || raw === "" || typeof raw === "string" && ["n/a", "na", "free", "none"].includes(raw.trim().toLowerCase())) {
          patch[key] = 0;
        } else {
          const parsed = Number(raw);
          if (Number.isFinite(parsed) && parsed >= 0) {
            patch[key] = Math.round(parsed);
          } else {
            delete patch[key];
          }
        }
      }
    }
    Object.assign(state.settings, patch);
    storeRepo.commit();
    res.json({ settings: state.settings });
  });
  app2.post("/api/admin/coupons", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const { code, discountType, value, minOrderAmount, description } = req.body;
    if (!code || !value) return res.status(400).json({ error: "Coupon code and value required." });
    const upper = String(code).trim().toUpperCase();
    const existingIdx = state.coupons.findIndex((c) => c.code === upper);
    const coupon = {
      code: upper,
      discountType: discountType === "flat" ? "flat" : "percent",
      value: Number(value),
      minOrderAmount: Number(minOrderAmount || 0),
      active: true,
      description: String(description || `${value} discount`)
    };
    if (existingIdx >= 0) {
      state.coupons[existingIdx] = coupon;
    } else {
      state.coupons.push(coupon);
    }
    storeRepo.commit();
    res.json({ coupons: state.coupons });
  });
  app2.delete("/api/admin/coupons/:code", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.coupons = state.coupons.filter(
      (c) => c.code.toUpperCase() !== req.params.code.toUpperCase()
    );
    storeRepo.commit();
    res.json({ coupons: state.coupons });
  });
  app2.get("/api/admin/orders/export", requireAdmin, (_req, res) => {
    const orders2 = storeRepo.getState().orders;
    const headers = [
      "Order ID",
      "Date (ISO)",
      "Customer Name",
      "Email",
      "Phone",
      "Address",
      "City",
      "State",
      "PIN",
      "Items",
      "Total Paid (INR)",
      "Payment Method",
      "Payment Status",
      "Order Status",
      "Courier Partner",
      "Tracking ID"
    ];
    const csvCell = (val) => `"${String(val ?? "").replaceAll('"', '""')}"`;
    const rows = orders2.map(
      (o) => [
        o.orderNumber,
        o.createdAt,
        o.customerName,
        o.customerEmail,
        o.customerPhone,
        [
          o.shippingAddress.houseFlatNumber,
          o.shippingAddress.line1,
          o.shippingAddress.line2,
          o.shippingAddress.landmark
        ].filter(Boolean).join(", "),
        o.shippingAddress.city,
        o.shippingAddress.state,
        o.shippingAddress.pincode,
        o.items.map((i) => `${i.quantity}x ${i.netQuantity}`).join("; "),
        o.totalAmount,
        o.paymentMethod,
        o.paymentStatus,
        o.status,
        o.courierPartner || "",
        o.trackingNumber || ""
      ].map(csvCell).join(",")
    );
    const csv = [headers.map(csvCell).join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="himrudra-orders.csv"');
    res.send(csv);
  });
  app2.put("/api/admin/orders/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const order = state.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found." });
    const {
      status,
      courierPartner,
      trackingNumber,
      trackingUrl,
      estimatedDelivery,
      actualShippingCost,
      paymentStatus,
      refundAmount,
      refundReason,
      note
    } = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (courierPartner !== void 0) order.courierPartner = courierPartner.trim();
    if (trackingNumber !== void 0) order.trackingNumber = trackingNumber.trim();
    if (trackingUrl !== void 0) order.trackingUrl = trackingUrl.trim() || void 0;
    if (estimatedDelivery !== void 0) order.estimatedDelivery = estimatedDelivery;
    if (typeof actualShippingCost === "number" && actualShippingCost >= 0) {
      order.actualShippingCost = actualShippingCost;
    }
    if (paymentStatus && paymentStatus !== order.paymentStatus) {
      order.paymentStatus = paymentStatus;
      if (paymentStatus === "Refund Requested") {
        order.refundRequestedAt = nowIso;
        state.adminNotifications.unshift({
          id: `notif-${crypto6.randomUUID().slice(0, 8)}`,
          type: "refund_request",
          title: "Refund Request Logged",
          message: `${order.orderNumber} (${order.customerName}) marked for refund review`,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          amount: order.totalAmount,
          read: false,
          createdAt: nowIso
        });
      }
      if (paymentStatus === "Refunded") {
        order.refundAmount = typeof refundAmount === "number" ? refundAmount : order.refundAmount ?? order.totalAmount;
        if (refundReason) order.refundReason = refundReason;
      }
    }
    if (status && status !== order.status) {
      const prevStatus = order.status;
      order.status = status;
      const enteringRestockState = (status === "Cancelled" || status === "Refunded") && prevStatus !== "Cancelled" && prevStatus !== "Refunded";
      if (enteringRestockState) {
        for (const item of order.items) {
          const prod = state.products.find((p) => p.id === item.productId);
          if (prod) {
            prod.stock += item.quantity;
          }
        }
      }
      if (status === "Dispatched") {
        order.dispatchedAt = nowIso;
      }
      if (status === "Delivered") {
        order.deliveredAt = nowIso;
        if (order.paymentMethod === "COD") {
          order.paymentStatus = "Paid";
        }
      }
      if (status === "Refunded") {
        order.paymentStatus = "Refunded";
        order.refundAmount = typeof refundAmount === "number" ? refundAmount : order.refundAmount ?? order.totalAmount;
        if (refundReason) order.refundReason = refundReason;
      }
      order.timeline.push({
        status,
        timestamp: nowIso,
        note: note?.trim() || (order.trackingNumber ? `Status updated to ${status} (${order.courierPartner || "Courier"}: ${order.trackingNumber})` : enteringRestockState ? `Order marked as ${status} by store administrator (inventory restored)` : `Order marked as ${status} by store administrator`)
      });
    }
    storeRepo.commit();
    res.json({ order });
  });
  app2.get("/api/admin/promotions", requireAdmin, (_req, res) => {
    res.json({ promotions: storeRepo.getState().promotions });
  });
  app2.post("/api/admin/promotions", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const {
      title,
      description,
      bannerHeadline,
      bannerSubtext,
      bannerTheme,
      startsAt,
      endsAt,
      freeShipping,
      freeShippingSpeed,
      discountPercent,
      promoCode,
      enabled
    } = req.body;
    if (!title?.trim() || !endsAt) {
      return res.status(400).json({ error: "Promotion title and end date are required." });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const promo = {
      id: `promo-${crypto6.randomUUID().slice(0, 8)}`,
      title: title.trim(),
      description: (description || "").trim(),
      bannerHeadline: (bannerHeadline || title).trim(),
      bannerSubtext: (bannerSubtext || "Hurry! Limited-time HimRudra offer.").trim(),
      bannerTheme: bannerTheme || "crystal-brown-gold",
      startsAt: startsAt || nowIso,
      endsAt,
      freeShipping: Boolean(freeShipping),
      freeShippingSpeed: freeShippingSpeed === "all" ? "all" : "standard",
      discountPercent: Math.max(0, Math.min(90, Number(discountPercent || 0))),
      promoCode: promoCode?.trim() ? promoCode.trim().toUpperCase() : void 0,
      enabled: enabled !== false,
      usageCount: 0,
      revenueGenerated: 0,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    state.promotions.unshift(promo);
    storeRepo.commit();
    res.status(201).json({ promotion: promo, promotions: state.promotions });
  });
  app2.put("/api/admin/promotions/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const promo = state.promotions.find((p) => p.id === req.params.id);
    if (!promo) return res.status(404).json({ error: "Promotion not found." });
    const patch = req.body;
    if (typeof patch.title === "string" && patch.title.trim()) promo.title = patch.title.trim();
    if (typeof patch.description === "string") promo.description = patch.description.trim();
    if (typeof patch.bannerHeadline === "string") promo.bannerHeadline = patch.bannerHeadline.trim();
    if (typeof patch.bannerSubtext === "string") promo.bannerSubtext = patch.bannerSubtext.trim();
    if (patch.bannerTheme) promo.bannerTheme = patch.bannerTheme;
    if (typeof patch.startsAt === "string" && patch.startsAt) promo.startsAt = patch.startsAt;
    if (typeof patch.endsAt === "string" && patch.endsAt) promo.endsAt = patch.endsAt;
    if (typeof patch.freeShipping === "boolean") promo.freeShipping = patch.freeShipping;
    if (patch.freeShippingSpeed === "all" || patch.freeShippingSpeed === "standard") {
      promo.freeShippingSpeed = patch.freeShippingSpeed;
    }
    if (typeof patch.discountPercent === "number") {
      promo.discountPercent = Math.max(0, Math.min(90, patch.discountPercent));
    }
    if (patch.promoCode !== void 0) {
      promo.promoCode = patch.promoCode.trim() ? patch.promoCode.trim().toUpperCase() : void 0;
    }
    if (typeof patch.enabled === "boolean") promo.enabled = patch.enabled;
    promo.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    storeRepo.commit();
    res.json({ promotion: promo, promotions: state.promotions });
  });
  app2.delete("/api/admin/promotions/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.promotions = state.promotions.filter((p) => p.id !== req.params.id);
    storeRepo.commit();
    res.json({ ok: true, promotions: state.promotions });
  });
  app2.put("/api/admin/notifications/read-all", requireAdmin, (_req, res) => {
    const state = storeRepo.getState();
    for (const n of state.adminNotifications) {
      n.read = true;
    }
    storeRepo.commit();
    res.json({ notifications: state.adminNotifications });
  });
  app2.put("/api/admin/notifications/:id/read", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const notif = state.adminNotifications.find((n) => n.id === req.params.id);
    if (notif) {
      notif.read = true;
      storeRepo.commit();
    }
    res.json({ notifications: state.adminNotifications });
  });
  app2.post("/api/admin/lab-reports", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const body = req.body;
    if (!body.laboratoryName || !body.reportNumber || !body.testedBatchNumber) {
      return res.status(400).json({
        error: "Laboratory name, report number, and batch number are required."
      });
    }
    const newReport = {
      id: `lab-${crypto6.randomUUID().slice(0, 8)}`,
      laboratoryName: body.laboratoryName.trim(),
      reportNumber: body.reportNumber.trim(),
      testedBatchNumber: body.testedBatchNumber.trim(),
      testDate: body.testDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      mappedProductIds: body.mappedProductIds?.length ? body.mappedProductIds : ["himrudra-shilajit-20g"],
      testingMethodology: body.testingMethodology || "ICP-MS & USP Microbiological Screening",
      verifiedStatus: body.verifiedStatus || "Pending Verification",
      notes: body.notes || "Uploaded via HimRudra Quality CMS.",
      customDocumentUrl: body.customDocumentUrl,
      originalFileName: body.originalFileName,
      originalMimeType: body.originalMimeType,
      heavyMetals: body.heavyMetals?.length ? body.heavyMetals : [
        {
          parameter: "Lead (Pb)",
          method: "ICP-MS",
          specificationLimit: "NMT 2.0 ppm",
          observedResult: "0.25 ppm",
          status: "Within Limit"
        },
        {
          parameter: "Arsenic (As)",
          method: "ICP-MS",
          specificationLimit: "NMT 1.0 ppm",
          observedResult: "0.12 ppm",
          status: "Within Limit"
        }
      ],
      microbiological: body.microbiological?.length ? body.microbiological : [
        {
          parameter: "Total Aerobic Microbial Count",
          method: "Plate Count",
          limit: "< 1,000 CFU/g",
          observedResult: "< 100 CFU/g",
          status: "Conforms"
        }
      ],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    state.labReports.unshift(newReport);
    storeRepo.commit();
    res.status(201).json({ labReport: newReport });
  });
  app2.put("/api/admin/lab-reports/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const report = state.labReports.find((r) => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: "Lab report not found." });
    Object.assign(report, req.body, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    storeRepo.commit();
    res.json({ labReport: report });
  });
  app2.delete("/api/admin/lab-reports/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.labReports = state.labReports.filter((r) => r.id !== req.params.id);
    storeRepo.commit();
    res.json({ ok: true });
  });
  app2.post("/api/admin/upload-report", requireAdmin, async (req, res) => {
    const { fileName, mimeType, base64Data, folder } = req.body;
    if (!fileName || !base64Data) {
      return res.status(400).json({ error: "File name and data are required." });
    }
    const mimeCheck = validateAllowedUploadMime(mimeType || "");
    if (!mimeCheck.valid) {
      return res.status(400).json({
        error: "Unsupported file format. Upload PDF, JPG, PNG, or WEBP files only."
      });
    }
    const safeMime = mimeCheck.safeMime;
    const ext = safeMime === "application/pdf" ? ".pdf" : safeMime === "image/png" ? ".png" : safeMime === "image/webp" ? ".webp" : ".jpg";
    const safeBase = path2.basename(fileName, path2.extname(fileName)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
    const outName = `${safeBase || "report"}-${Date.now()}${ext}`;
    const cleanB64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
    const buffer = Buffer.from(cleanB64, "base64");
    if (buffer.length === 0) {
      return res.status(400).json({ error: "Uploaded file is empty." });
    }
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: "File exceeds the 5 MB upload limit." });
    }
    if (s3MediaService.isEnabled()) {
      try {
        const targetFolder = folder === "products" || folder === "lab-reports" ? folder : "lab-reports";
        const uploaded = await s3MediaService.uploadBuffer({
          buffer,
          fileName: outName,
          contentType: safeMime,
          folder: targetFolder
        });
        return res.status(201).json({
          url: uploaded.url,
          storage: "aws-s3",
          key: uploaded.key,
          bytes: uploaded.bytes,
          originalFileName: fileName,
          originalMimeType: safeMime
        });
      } catch (err) {
        const statusCode = err instanceof StorePersistenceError ? err.statusCode : 503;
        const message = err instanceof Error ? err.message : "Failed to upload file to AWS S3.";
        return res.status(statusCode).json({ error: message, requestId: req.requestId });
      }
    }
    if (IS_SERVERLESS2) {
      if (storeRepo.isDynamoEnabled() && buffer.length > MAX_INLINE_DATA_URI_BYTES) {
        return res.status(413).json({
          error: "File is larger than 260 KB. Configure AWS_S3_BUCKET to store large product images and PDF certificates safely in AWS S3, or compress the file below 260 KB.",
          code: "S3_REQUIRED_FOR_LARGE_FILE"
        });
      }
      return res.status(201).json({
        url: `data:${safeMime};base64,${cleanB64}`,
        storage: "inline-data-uri",
        bytes: buffer.length,
        originalFileName: fileName,
        originalMimeType: safeMime
      });
    }
    const uploadsDir = path2.resolve(process.cwd(), "public", "uploads");
    if (!fs2.existsSync(uploadsDir)) {
      fs2.mkdirSync(uploadsDir, { recursive: true });
    }
    fs2.writeFileSync(path2.join(uploadsDir, outName), buffer);
    res.status(201).json({
      url: `/uploads/${outName}`,
      storage: "local-disk",
      bytes: buffer.length,
      originalFileName: fileName,
      originalMimeType: safeMime
    });
  });
  app2.post("/api/admin/cms", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const { title, category, content, approvedByAdmin } = req.body;
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: "Title and content are required." });
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const newSection = {
      id: `cms-${crypto6.randomUUID().slice(0, 8)}`,
      key: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      title: title.trim(),
      category: category === "faq" ? "faq" : "product",
      content: content.trim(),
      approvedByAdmin: Boolean(approvedByAdmin),
      approvedAt: approvedByAdmin ? now : void 0,
      updatedAt: now
    };
    state.cmsSections.push(newSection);
    storeRepo.commit();
    res.status(201).json({ section: newSection });
  });
  app2.put("/api/admin/cms/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const section = state.cmsSections.find((s) => s.id === req.params.id);
    if (!section) return res.status(404).json({ error: "CMS section not found." });
    const { title, content, approvedByAdmin } = req.body;
    if (typeof title === "string" && title.trim()) section.title = title.trim();
    if (typeof content === "string" && content.trim()) section.content = content.trim();
    if (typeof approvedByAdmin === "boolean") {
      section.approvedByAdmin = approvedByAdmin;
      section.approvedAt = approvedByAdmin ? (/* @__PURE__ */ new Date()).toISOString() : void 0;
    }
    section.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    storeRepo.commit();
    res.json({ section });
  });
  app2.post("/api/admin/expenses", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const { date, category, description, amount } = req.body;
    if (!description || typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "Valid description and positive amount required." });
    }
    const expense = {
      id: `exp-${crypto6.randomUUID().slice(0, 8)}`,
      date: date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      category: category || "Operations",
      description: description.trim(),
      amount
    };
    state.expenses.unshift(expense);
    storeRepo.commit();
    res.status(201).json({ expense });
  });
  app2.delete("/api/admin/expenses/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    state.expenses = state.expenses.filter((e) => e.id !== req.params.id);
    storeRepo.commit();
    res.json({ ok: true });
  });
  app2.put("/api/admin/inquiries/:id", requireAdmin, (req, res) => {
    const state = storeRepo.getState();
    const inq = state.inquiries.find((i) => i.id === req.params.id);
    if (!inq) return res.status(404).json({ error: "Inquiry not found." });
    inq.status = req.body.status === "Responded" ? "Responded" : "New";
    if (inq.status === "Responded" && !inq.repliedAt) {
      inq.repliedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    storeRepo.commit();
    res.json({ inquiry: inq });
  });
  app2.post("/api/admin/inquiries/:id/reply", requireAdmin, async (req, res) => {
    const state = storeRepo.getState();
    const inq = state.inquiries.find((i) => i.id === req.params.id);
    if (!inq) return res.status(404).json({ error: "Inquiry not found." });
    const { replyMessage, channel } = req.body;
    const trimmedReply = (replyMessage ?? "").trim();
    if (!trimmedReply) {
      return res.status(400).json({ error: "Please write a response before sending." });
    }
    const usedChannel = channel === "WhatsApp" || channel === "SMS" || channel === "Direct" ? channel : "Email";
    const links = buildInquiryReplyLinks(inq, trimmedReply, "HimRudra Support");
    let emailDelivered = false;
    let emailError;
    const resendKey = process.env.RESEND_API_KEY?.trim();
    const resendFrom = process.env.RESEND_FROM_EMAIL?.trim() || "HimRudra Support <onboarding@resend.dev>";
    if (resendKey && (usedChannel === "Email" || usedChannel === "Direct")) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: resendFrom,
            to: [inq.email],
            reply_to: state.settings.brandEmail,
            subject: links.subject,
            text: links.formattedBody
          })
        });
        if (emailRes.ok) {
          emailDelivered = true;
        } else {
          const errPayload = await emailRes.json().catch(() => ({}));
          emailError = errPayload.message || "Direct mail server rejected request; use email client link.";
        }
      } catch {
        emailError = "Could not reach mail server; use the direct email link below.";
      }
    }
    inq.status = "Responded";
    inq.replyMessage = trimmedReply;
    inq.repliedAt = (/* @__PURE__ */ new Date()).toISOString();
    const prevChannels = Array.isArray(inq.repliedVia) ? inq.repliedVia : [];
    inq.repliedVia = prevChannels.includes(usedChannel) ? prevChannels : [...prevChannels, usedChannel];
    inq.emailDeliveryStatus = emailDelivered ? "sent" : "mailto_ready";
    storeRepo.commit();
    res.json({
      inquiry: inq,
      emailDelivered,
      emailError,
      links
    });
  });
  app2.put("/api/admin/password", requireAdmin, async (req, res) => {
    const user = req.currentUser;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !await verifyPasswordAsync(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (!newPassword || newPassword.trim().length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters long." });
    }
    user.passwordHash = await hashPasswordAsync(newPassword.trim());
    storeRepo.commit();
    res.json({ ok: true });
  });
  app2.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
  });
  app2.use((err, req, res, _next) => {
    const isBodyTooLarge = typeof err === "object" && err !== null && "type" in err && err.type === "entity.too.large";
    const isBadJson = err instanceof SyntaxError && typeof err === "object" && "status" in err && err.status === 400;
    const statusCode = isBodyTooLarge ? 413 : isBadJson ? 400 : err instanceof StorePersistenceError ? err.statusCode : 500;
    const code = isBodyTooLarge ? "PAYLOAD_TOO_LARGE" : isBadJson ? "INVALID_JSON" : err instanceof StorePersistenceError ? err.code : "INTERNAL_SERVER_ERROR";
    const message = isBodyTooLarge ? "Request payload exceeds the 5 MB limit." : isBadJson ? "Malformed JSON request payload." : err instanceof Error ? err.message : "Unexpected server error.";
    logStructured("error", "express", "unhandled_route_error", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode,
      code,
      error: message
    });
    if (!res.headersSent) {
      res.status(statusCode).json({ error: message, code, requestId: req.requestId });
    }
  });
  return app2;
}
var app = createApiApp();
var server_default = app;
async function startServer() {
  if (!IS_SERVERLESS2 && process.env.NODE_ENV !== "production") {
    const vitePkg = "vite";
    const { createServer: createViteServer } = await import(
      /* @vite-ignore */
      vitePkg
    );
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const publicDir = path2.resolve(process.cwd(), "public");
    const distDir = path2.resolve(process.cwd(), "dist");
    app.use(
      "/assets",
      express.static(path2.join(distDir, "assets"), {
        maxAge: "365d",
        immutable: true
      })
    );
    app.use(express.static(publicDir, { maxAge: "1h" }));
    app.use(express.static(distDir, { maxAge: "1h" }));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distDir, "index.html"));
    });
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    logStructured("info", "server", "listening", {
      port: PORT,
      database: storeRepo.getStorageStatus().engine,
      mediaStorage: s3MediaService.getStatus().engine
    });
  });
  server.keepAliveTimeout = 65e3;
  server.headersTimeout = 66e3;
  server.maxConnections = 2e3;
}
var isDirectRun = !IS_SERVERLESS2 && typeof process.argv[1] === "string" && path2.resolve(process.argv[1]) === path2.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  process.on("unhandledRejection", (reason) => {
    logStructured("error", "process", "unhandled_rejection", {
      error: reason instanceof Error ? reason.message : String(reason)
    });
  });
  process.on("uncaughtException", (err) => {
    logStructured("error", "process", "uncaught_exception", {
      error: err.message
    });
  });
  void startServer();
}
export {
  app,
  createApiApp,
  server_default as default,
  parseCookies
};
