import { and, asc, eq, gte, notInArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  adminNotifications,
  cmsSections,
  coupons,
  expenses,
  inquiries,
  labReports,
  orders,
  paymentIntents,
  products,
  promotions,
  storeSettings,
  users,
} from './schema.ts';
import type { DatabaseState, PaymentIntentRecord, StoredUser } from '../../server/store.ts';
import type {
  AdminNotification,
  BannerTheme,
  CmsSection,
  ContactInquiry,
  Coupon,
  Expense,
  LabReport,
  Order,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  Product,
  Promotion,
} from '../types.ts';
import { StorePersistenceError } from '../../server/validation.ts';
import { logStructured } from '../../server/logger.ts';

function isTableEmpty(state: {
  userCount: number;
  productCount: number;
  settingsCount: number;
}): boolean {
  return state.userCount === 0 && state.productCount === 0 && state.settingsCount === 0;
}

export class PostgresStateAdapter {
  async loadState(fallbackSeed: DatabaseState): Promise<{
    empty: boolean;
    state: DatabaseState;
  }> {
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
        settingsRows,
      ] = await Promise.all([
        db.select().from(users).orderBy(asc(users.createdAt)),
        db.select().from(products).orderBy(asc(products.sortOrder)),
        db.select().from(orders).orderBy(asc(orders.sortOrder)),
        db.select().from(coupons).orderBy(asc(coupons.sortOrder)),
        db.select().from(promotions).orderBy(asc(promotions.sortOrder)),
        db.select().from(labReports).orderBy(asc(labReports.sortOrder)),
        db.select().from(cmsSections).orderBy(asc(cmsSections.sortOrder)),
        db.select().from(expenses).orderBy(asc(expenses.sortOrder)),
        db.select().from(inquiries).orderBy(asc(inquiries.sortOrder)),
        db.select().from(adminNotifications).orderBy(asc(adminNotifications.sortOrder)),
        db.select().from(paymentIntents),
        db.select().from(storeSettings).where(eq(storeSettings.id, 'default')).limit(1),
      ]);

      if (
        isTableEmpty({
          userCount: userRows.length,
          productCount: productRows.length,
          settingsCount: settingsRows.length,
        })
      ) {
        return { empty: true, state: fallbackSeed };
      }

      const mappedUsers: StoredUser[] = userRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role === 'admin' ? 'admin' : 'customer',
        passwordHash: row.passwordHash,
        defaultAddress: row.defaultAddress ?? undefined,
        wishlistProductIds: Array.isArray(row.wishlistProductIds) ? row.wishlistProductIds : [],
        createdAt: row.createdAt,
      }));

      const mappedProducts: Product[] = productRows.map((row) => ({
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
        customImages: Array.isArray(row.customImages) ? row.customImages : undefined,
        active: row.active,
      }));

      const mappedOrders: Order[] = orderRows.map((row) => ({
        id: row.id,
        orderNumber: row.orderNumber,
        userId: row.userId ?? undefined,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        customerPhone: row.customerPhone,
        shippingAddress: row.shippingAddress,
        deliveryInstructions: row.deliveryInstructions ?? undefined,
        items: Array.isArray(row.items) ? row.items : [],
        subtotal: row.subtotal,
        mrpTotal: row.mrpTotal,
        instantSavings: row.instantSavings,
        couponCode: row.couponCode ?? undefined,
        couponDiscount: row.couponDiscount,
        promotionId: row.promotionId ?? undefined,
        promotionTitle: row.promotionTitle ?? undefined,
        shippingFee: row.shippingFee,
        shippingSpeed: row.shippingSpeed === 'express' ? 'express' : 'standard',
        codFee: row.codFee,
        taxableValue: row.taxableValue,
        gstAmount: row.gstAmount,
        totalAmount: row.totalAmount,
        gatewayFeeAmount: row.gatewayFeeAmount ?? undefined,
        actualShippingCost: row.actualShippingCost ?? undefined,
        paymentMethod: row.paymentMethod as PaymentMethod,
        paymentStatus: row.paymentStatus as OrderPaymentStatus,
        razorpayOrderId: row.razorpayOrderId ?? undefined,
        razorpayPaymentId: row.razorpayPaymentId ?? undefined,
        paymentVerifiedAt: row.paymentVerifiedAt ?? undefined,
        status: row.status as OrderStatus,
        courierPartner: row.courierName ?? undefined,
        trackingNumber: row.trackingNumber ?? undefined,
        trackingUrl: row.trackingUrl ?? undefined,
        estimatedDelivery: row.estimatedDelivery ?? undefined,
        dispatchedAt: row.dispatchedAt ?? undefined,
        deliveredAt: row.deliveredAt ?? undefined,
        refundAmount: row.refundAmount ?? undefined,
        refundReason: row.refundReason ?? undefined,
        refundRequestedAt: row.refundRequestedAt ?? undefined,
        timeline: Array.isArray(row.timeline) ? row.timeline : [],
        createdAt: row.createdAt,
      }));

      const mappedCoupons: Coupon[] = couponRows.map((row) => ({
        code: row.code,
        discountType: row.type === 'flat' ? 'flat' : 'percent',
        value: row.value,
        minOrderAmount: row.minOrderValue,
        active: row.active,
        description: row.description,
      }));

      const mappedPromotions: Promotion[] = promotionRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        bannerHeadline: row.bannerHeadline,
        bannerSubtext: row.bannerSubtext,
        bannerTheme: row.bannerTheme as BannerTheme,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        freeShipping: row.freeShipping,
        freeShippingSpeed: row.freeShippingSpeed === 'all' ? 'all' : 'standard',
        discountPercent: row.discountPercent,
        promoCode: row.promoCode ?? undefined,
        enabled: row.enabled,
        usageCount: row.usageCount,
        revenueGenerated: row.revenueGenerated,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      const mappedLabReports: LabReport[] = labReportRows.map((row) => ({
        id: row.id,
        laboratoryName: row.laboratoryName,
        reportNumber: row.reportNumber,
        testedBatchNumber: row.testedBatchNumber,
        testDate: row.testDate,
        mappedProductIds: Array.isArray(row.mappedProductIds) ? row.mappedProductIds : [],
        testingMethodology: row.testingMethodology || row.accreditation || '',
        verifiedStatus:
          row.verifiedStatus === 'Verified' || row.verifiedStatus === 'Pending Verification'
            ? row.verifiedStatus
            : 'Reference Sample',
        notes: row.notes || row.summaryNote || '',
        customDocumentUrl: row.customDocumentUrl ?? undefined,
        originalFileName: row.originalFileName ?? undefined,
        originalMimeType: row.originalMimeType ?? undefined,
        heavyMetals: Array.isArray(row.heavyMetals) ? row.heavyMetals : [],
        microbiological: Array.isArray(row.microbiological) ? row.microbiological : [],
        updatedAt: row.updatedAt || row.testDate,
      }));

      const mappedCms: CmsSection[] = cmsRows.map((row) => ({
        id: row.id,
        key: row.key,
        title: row.title,
        category: row.category === 'faq' ? 'faq' : 'product',
        content: row.content,
        approvedByAdmin: row.approvedByAdmin,
        approvedAt: row.approvedAt ?? undefined,
        updatedAt: row.updatedAt,
      }));

      const mappedExpenses: Expense[] = expenseRows.map((row) => ({
        id: row.id,
        date: row.date,
        category: row.category as Expense['category'],
        description: row.description,
        amount: row.amount,
      }));

      const mappedInquiries: ContactInquiry[] = inquiryRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone || undefined,
        subject: row.subject,
        message: row.message,
        status: row.status === 'Responded' ? 'Responded' : 'New',
        replyMessage: row.replyMessage ?? undefined,
        repliedAt: row.repliedAt ?? undefined,
        repliedVia: Array.isArray(row.repliedVia) ? row.repliedVia : undefined,
        emailDeliveryStatus:
          row.emailDeliveryStatus === 'sent' || row.emailDeliveryStatus === 'mailto_ready'
            ? row.emailDeliveryStatus
            : undefined,
        createdAt: row.createdAt,
      }));

      const mappedNotifs: AdminNotification[] = notifRows.map((row) => ({
        id: row.id,
        type: row.type as AdminNotification['type'],
        title: row.title,
        message: row.message,
        orderId: row.orderId ?? undefined,
        orderNumber: row.orderNumber ?? undefined,
        customerName: row.customerName ?? undefined,
        amount: row.amount ?? undefined,
        read: row.read,
        emailNotifiedTo: row.emailNotifiedTo ?? undefined,
        createdAt: row.createdAt,
      }));

      const mappedIntents: Record<string, PaymentIntentRecord> = {};
      for (const row of intentRows) {
        mappedIntents[row.razorpayOrderId] = {
          razorpayOrderId: row.razorpayOrderId,
          amountPaise: row.amountPaise,
          verified: row.verified,
          paymentId: row.paymentId ?? undefined,
          signatureVerified: row.signatureVerified,
          method: row.method,
          createdAt: row.createdAt,
        };
      }

      return {
        empty: false,
        state: {
          users: mappedUsers,
          products: mappedProducts,
          settings: settingsRows[0]?.payload ?? fallbackSeed.settings,
          coupons: mappedCoupons,
          promotions: mappedPromotions,
          orders: mappedOrders,
          labReports: mappedLabReports,
          cmsSections: mappedCms,
          expenses: mappedExpenses,
          inquiries: mappedInquiries,
          adminNotifications: mappedNotifs,
          paymentIntents: mappedIntents,
        },
      };
    } catch (error) {
      logStructured('error', 'cloud-sql', 'load_state_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Database read failed. Please try again shortly.', {
        code: 'POSTGRES_READ_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  /**
   * Atomically verifies & decrements product stock and creates the order inside a single PostgreSQL ACID transaction.
   * Guarantees zero overselling even when 500 concurrent users check out at the exact same millisecond.
   */
  async transactCreateOrderAndDecrementStock(params: {
    order: Order;
    stockDecrements: Array<{ productId: string; quantity: number }>;
  }): Promise<void> {
    const startedAt = Date.now();
    try {
      await db.transaction(async (tx) => {
        for (const dec of params.stockDecrements) {
          const updated = await tx
            .update(products)
            .set({
              stock: sql`${products.stock} - ${dec.quantity}`,
              updatedAt: new Date(),
            })
            .where(and(eq(products.id, dec.productId), gte(products.stock, dec.quantity)))
            .returning({ id: products.id, stock: products.stock });

          if (updated.length === 0) {
            throw new StorePersistenceError(
              'Order could not be completed because one or more items just went out of stock. Please review your cart and try again.',
              {
                code: 'ORDER_STOCK_CONFLICT',
                statusCode: 409,
                retryable: false,
              }
            );
          }
        }

        const o = params.order;
        await tx
          .insert(orders)
          .values({
            id: o.id,
            sortOrder: 0,
            orderNumber: o.orderNumber,
            userId: o.userId ?? null,
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
            createdAt: o.createdAt,
          })
          .onConflictDoNothing({ target: orders.id });
      });

      logStructured('info', 'cloud-sql', 'transact_order_success', {
        orderId: params.order.id,
        orderNumber: params.order.orderNumber,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof StorePersistenceError) {
        throw error;
      }
      logStructured('error', 'cloud-sql', 'transact_order_failed', {
        orderId: params.order.id,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Unable to confirm your order right now. Please try again.', {
        code: 'POSTGRES_TX_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  /**
   * Synchronizes all entities transactionally into PostgreSQL using Drizzle type-safe upserts & targeted deletions.
   */
  async persistState(state: DatabaseState): Promise<void> {
    const startedAt = Date.now();
    try {
      await db.transaction(async (tx) => {
        // 1. Settings
        await tx
          .insert(storeSettings)
          .values({
            id: 'default',
            payload: state.settings,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: storeSettings.id,
            set: {
              payload: state.settings,
              updatedAt: new Date(),
            },
          });

        // 2. Users (upsert before orders so foreign keys always resolve)
        const userIds: string[] = [];
        for (const u of state.users) {
          userIds.push(u.id);
          await tx
            .insert(users)
            .values({
              id: u.id,
              name: u.name,
              email: u.email,
              phone: u.phone,
              role: u.role,
              passwordHash: u.passwordHash,
              defaultAddress: u.defaultAddress ?? null,
              wishlistProductIds: u.wishlistProductIds ?? [],
              createdAt: u.createdAt,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: users.id,
              set: {
                name: u.name,
                email: u.email,
                phone: u.phone,
                role: u.role,
                passwordHash: u.passwordHash,
                defaultAddress: u.defaultAddress ?? null,
                wishlistProductIds: u.wishlistProductIds ?? [],
                updatedAt: new Date(),
              },
            });
        }
        if (userIds.length > 0) {
          await tx.delete(users).where(notInArray(users.id, userIds));
        }

        // 3. Products
        const productIds: string[] = [];
        for (let idx = 0; idx < state.products.length; idx += 1) {
          const p = state.products[idx];
          productIds.push(p.id);
          await tx
            .insert(products)
            .values({
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
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
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
                updatedAt: new Date(),
              },
            });
        }
        if (productIds.length > 0) {
          await tx.delete(products).where(notInArray(products.id, productIds));
        } else {
          await tx.delete(products);
        }

        // 4. Orders
        const validUserIdSet = new Set(userIds);
        const orderIds: string[] = [];
        for (let idx = 0; idx < state.orders.length; idx += 1) {
          const o = state.orders[idx];
          orderIds.push(o.id);
          const safeUserId = o.userId && validUserIdSet.has(o.userId) ? o.userId : null;
          await tx
            .insert(orders)
            .values({
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
              createdAt: o.createdAt,
            })
            .onConflictDoUpdate({
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
                timeline: o.timeline ?? [],
              },
            });
        }
        if (orderIds.length > 0) {
          await tx.delete(orders).where(notInArray(orders.id, orderIds));
        } else {
          await tx.delete(orders);
        }

        // 5. Coupons
        const couponIds: string[] = [];
        for (let idx = 0; idx < state.coupons.length; idx += 1) {
          const c = state.coupons[idx];
          couponIds.push(c.code);
          await tx
            .insert(coupons)
            .values({
              id: c.code,
              sortOrder: idx,
              code: c.code,
              type: c.discountType,
              value: c.value,
              minOrderValue: c.minOrderAmount,
              maxDiscount: null,
              active: c.active,
              description: c.description,
            })
            .onConflictDoUpdate({
              target: coupons.id,
              set: {
                sortOrder: idx,
                code: c.code,
                type: c.discountType,
                value: c.value,
                minOrderValue: c.minOrderAmount,
                active: c.active,
                description: c.description,
              },
            });
        }
        if (couponIds.length > 0) {
          await tx.delete(coupons).where(notInArray(coupons.id, couponIds));
        } else {
          await tx.delete(coupons);
        }

        // 6. Promotions
        const promoIds: string[] = [];
        for (let idx = 0; idx < state.promotions.length; idx += 1) {
          const pr = state.promotions[idx];
          promoIds.push(pr.id);
          await tx
            .insert(promotions)
            .values({
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
              updatedAt: pr.updatedAt,
            })
            .onConflictDoUpdate({
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
                updatedAt: pr.updatedAt,
              },
            });
        }
        if (promoIds.length > 0) {
          await tx.delete(promotions).where(notInArray(promotions.id, promoIds));
        } else {
          await tx.delete(promotions);
        }

        // 7. Lab Reports
        const labIds: string[] = [];
        for (let idx = 0; idx < state.labReports.length; idx += 1) {
          const r = state.labReports[idx];
          labIds.push(r.id);
          await tx
            .insert(labReports)
            .values({
              id: r.id,
              sortOrder: idx,
              batchNumber: r.testedBatchNumber,
              testedBatchNumber: r.testedBatchNumber,
              reportNumber: r.reportNumber,
              laboratoryName: r.laboratoryName,
              accreditation: r.testingMethodology,
              testDate: r.testDate,
              expiryDate: '',
              sampleDescription: '',
              fulvicAcidPercent: '',
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
              microbiological: r.microbiological ?? [],
            })
            .onConflictDoUpdate({
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
                microbiological: r.microbiological ?? [],
              },
            });
        }
        if (labIds.length > 0) {
          await tx.delete(labReports).where(notInArray(labReports.id, labIds));
        } else {
          await tx.delete(labReports);
        }

        // 8. CMS Sections
        const cmsIds: string[] = [];
        for (let idx = 0; idx < state.cmsSections.length; idx += 1) {
          const s = state.cmsSections[idx];
          cmsIds.push(s.id);
          await tx
            .insert(cmsSections)
            .values({
              id: s.id,
              sortOrder: idx,
              key: s.key,
              title: s.title,
              category: s.category,
              content: s.content,
              approvedByAdmin: s.approvedByAdmin,
              approvedAt: s.approvedAt ?? null,
              updatedAt: s.updatedAt,
            })
            .onConflictDoUpdate({
              target: cmsSections.id,
              set: {
                sortOrder: idx,
                key: s.key,
                title: s.title,
                category: s.category,
                content: s.content,
                approvedByAdmin: s.approvedByAdmin,
                approvedAt: s.approvedAt ?? null,
                updatedAt: s.updatedAt,
              },
            });
        }
        if (cmsIds.length > 0) {
          await tx.delete(cmsSections).where(notInArray(cmsSections.id, cmsIds));
        } else {
          await tx.delete(cmsSections);
        }

        // 9. Expenses
        const expenseIds: string[] = [];
        for (let idx = 0; idx < state.expenses.length; idx += 1) {
          const e = state.expenses[idx];
          expenseIds.push(e.id);
          await tx
            .insert(expenses)
            .values({
              id: e.id,
              sortOrder: idx,
              date: e.date,
              category: e.category,
              description: e.description,
              amount: e.amount,
            })
            .onConflictDoUpdate({
              target: expenses.id,
              set: {
                sortOrder: idx,
                date: e.date,
                category: e.category,
                description: e.description,
                amount: e.amount,
              },
            });
        }
        if (expenseIds.length > 0) {
          await tx.delete(expenses).where(notInArray(expenses.id, expenseIds));
        } else {
          await tx.delete(expenses);
        }

        // 10. Customer Inquiries
        const inquiryIds: string[] = [];
        for (let idx = 0; idx < state.inquiries.length; idx += 1) {
          const inq = state.inquiries[idx];
          inquiryIds.push(inq.id);
          await tx
            .insert(inquiries)
            .values({
              id: inq.id,
              sortOrder: idx,
              name: inq.name,
              email: inq.email,
              phone: inq.phone ?? '',
              subject: inq.subject,
              message: inq.message,
              status: inq.status,
              replyMessage: inq.replyMessage ?? null,
              repliedAt: inq.repliedAt ?? null,
              repliedVia: inq.repliedVia ?? null,
              emailDeliveryStatus: inq.emailDeliveryStatus ?? null,
              createdAt: inq.createdAt,
            })
            .onConflictDoUpdate({
              target: inquiries.id,
              set: {
                sortOrder: idx,
                name: inq.name,
                email: inq.email,
                phone: inq.phone ?? '',
                subject: inq.subject,
                message: inq.message,
                status: inq.status,
                replyMessage: inq.replyMessage ?? null,
                repliedAt: inq.repliedAt ?? null,
                repliedVia: inq.repliedVia ?? null,
                emailDeliveryStatus: inq.emailDeliveryStatus ?? null,
              },
            });
        }
        if (inquiryIds.length > 0) {
          await tx.delete(inquiries).where(notInArray(inquiries.id, inquiryIds));
        } else {
          await tx.delete(inquiries);
        }

        // 11. Admin Notifications
        const notifIds: string[] = [];
        for (let idx = 0; idx < state.adminNotifications.length; idx += 1) {
          const n = state.adminNotifications[idx];
          notifIds.push(n.id);
          await tx
            .insert(adminNotifications)
            .values({
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
              createdAt: n.createdAt,
            })
            .onConflictDoUpdate({
              target: adminNotifications.id,
              set: {
                sortOrder: idx,
                read: n.read,
                title: n.title,
                message: n.message,
                emailNotifiedTo: n.emailNotifiedTo ?? null,
              },
            });
        }
        if (notifIds.length > 0) {
          await tx.delete(adminNotifications).where(notInArray(adminNotifications.id, notifIds));
        } else {
          await tx.delete(adminNotifications);
        }

        // 12. Payment Intents
        const intentIds = Object.keys(state.paymentIntents || {});
        for (const intentId of intentIds) {
          const rec = state.paymentIntents[intentId];
          await tx
            .insert(paymentIntents)
            .values({
              razorpayOrderId: rec.razorpayOrderId,
              amountPaise: rec.amountPaise,
              verified: rec.verified,
              paymentId: rec.paymentId ?? null,
              signatureVerified: rec.signatureVerified,
              method: rec.method,
              createdAt: rec.createdAt,
            })
            .onConflictDoUpdate({
              target: paymentIntents.razorpayOrderId,
              set: {
                amountPaise: rec.amountPaise,
                verified: rec.verified,
                paymentId: rec.paymentId ?? null,
                signatureVerified: rec.signatureVerified,
                method: rec.method,
              },
            });
        }
        if (intentIds.length > 0) {
          await tx
            .delete(paymentIntents)
            .where(notInArray(paymentIntents.razorpayOrderId, intentIds));
        } else {
          await tx.delete(paymentIntents);
        }
      });

      logStructured('info', 'cloud-sql', 'persist_state_success', {
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logStructured('error', 'cloud-sql', 'persist_state_failed', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Database save failed. Please try again shortly.', {
        code: 'POSTGRES_WRITE_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }
}
