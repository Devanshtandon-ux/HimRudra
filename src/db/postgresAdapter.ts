import { and, asc, desc, eq, gte, notInArray, or, sql } from 'drizzle-orm';
import { createPool, db, getDatabaseEnvironmentInfo, isUsingExternalPostgresUrl } from './index.ts';
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
  PaymentSettlementStatus,
  Product,
  Promotion,
  ShippingAddress,
  StoreSettings,
} from '../types.ts';
import { StorePersistenceError } from '../../server/validation.ts';
import { logStructured } from '../../server/logger.ts';
import { recalculatePromotionAndCouponAnalytics } from '../lib/commerce.ts';

export interface PublicBootstrapDbData {
  products: Product[];
  settings: StoreSettings | null;
  coupons: Coupon[];
  promotions: Promotion[];
  labReports: LabReport[];
  cmsSections: CmsSection[];
}

export interface PostgresCheckoutContext {
  empty: boolean;
  products: Product[];
  coupons: Coupon[];
  promotions: Promotion[];
  settings: StoreSettings | null;
  paymentIntent: PaymentIntentRecord | null;
  existingOrderByPayment: Order | null;
  maxOrderSeq: number;
}

interface PgErrorLike {
  code?: unknown;
  message?: unknown;
  detail?: unknown;
  hint?: unknown;
  schema?: unknown;
  table?: unknown;
  column?: unknown;
  position?: unknown;
  cause?: PgErrorLike;
}

function getUnderlyingPgError(error: unknown): PgErrorLike | null {
  if (!error || typeof error !== 'object') return null;
  let current = error as PgErrorLike;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current.cause && typeof current.cause === 'object') {
      current = current.cause;
    } else {
      break;
    }
  }
  return current;
}

function getPgErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  let current: PgErrorLike | undefined = error as PgErrorLike;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current.code === 'string' && current.code) return current.code;
    current = current.cause && typeof current.cause === 'object' ? current.cause : undefined;
  }
  return '';
}

function getPgCauseMessage(error: unknown): string {
  const underlying = getUnderlyingPgError(error);
  if (underlying && typeof underlying.message === 'string' && underlying.message) {
    return underlying.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function extractMissingColumnName(message: string): string | undefined {
  const match = message.match(
    /column\s+["']?([a-zA-Z0-9_."']+)["']?\s+(?:of\s+relation\s+["']?[a-zA-Z0-9_."']+["']?\s+)?does not exist/i
  );
  return match?.[1]?.replaceAll('"', '').replaceAll("'", '');
}

export function extractPgDiagnostics(error: unknown): Record<string, unknown> {
  const topMessage = error instanceof Error ? error.message : String(error);
  const underlying = getUnderlyingPgError(error);
  const causeMessage = getPgCauseMessage(error);
  const code = getPgErrorCode(error) || undefined;
  const missingColumn =
    (typeof underlying?.column === 'string' && underlying.column) ||
    extractMissingColumnName(causeMessage) ||
    extractMissingColumnName(topMessage);

  return {
    pgCode: code,
    pgCause: causeMessage,
    ...(missingColumn ? { missingColumn } : {}),
    ...(typeof underlying?.table === 'string' && underlying.table ? { pgTable: underlying.table } : {}),
    ...(typeof underlying?.schema === 'string' && underlying.schema ? { pgSchema: underlying.schema } : {}),
    ...(typeof underlying?.detail === 'string' && underlying.detail ? { pgDetail: underlying.detail } : {}),
    ...(typeof underlying?.hint === 'string' && underlying.hint ? { pgHint: underlying.hint } : {}),
    ...(typeof underlying?.position === 'string' && underlying.position ? { pgPosition: underlying.position } : {}),
    ...(topMessage !== causeMessage ? { queryError: topMessage.slice(0, 400) } : {}),
  };
}

function isUndefinedTableError(error: unknown): boolean {
  if (getPgErrorCode(error) === '42P01') return true;
  const msg = `${error instanceof Error ? error.message : String(error)} ${getPgCauseMessage(error)}`;
  return /relation ["']?[a-z_]+["']? does not exist/i.test(msg);
}

function isUndefinedColumnError(error: unknown): boolean {
  if (getPgErrorCode(error) === '42703') return true;
  const msg = `${error instanceof Error ? error.message : String(error)} ${getPgCauseMessage(error)}`;
  return /column ["']?[a-z0-9_.]+["']? does not exist/i.test(msg);
}

function isTransientConnectionError(error: unknown): boolean {
  const code = getPgErrorCode(error);
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === '57P01' ||
    code === '08006' ||
    code === '08003'
  ) {
    return true;
  }
  const msg = `${error instanceof Error ? error.message : String(error)} ${getPgCauseMessage(error)}`;
  return /ECONNRESET|Connection terminated unexpectedly|terminating connection|socket hang up/i.test(
    msg
  );
}

const EXTERNAL_SCHEMA_DDL = `
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
  gateway_tax_amount double precision,
  gateway_fee_source text,
  actual_shipping_cost double precision,
  payment_method text NOT NULL,
  payment_status text NOT NULL,
  settlement_status text,
  razorpay_settlement_id text,
  settled_at text,
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
  checkout_payload jsonb,
  order_id text,
  gateway_fee_paise integer,
  gateway_tax_paise integer,
  created_at text NOT NULL,
  updated_at text
);
CREATE TABLE IF NOT EXISTS store_settings (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamp DEFAULT now()
);
`;

const REQUIRED_SCHEMA_COLUMNS: Record<string, string[]> = {
  orders: [
    'gateway_fee_amount',
    'gateway_tax_amount',
    'gateway_fee_source',
    'settlement_status',
    'razorpay_settlement_id',
    'settled_at',
    'razorpay_order_id',
    'razorpay_payment_id',
  ],
  payment_intents: [
    'razorpay_order_id',
    'checkout_payload',
    'order_id',
    'gateway_fee_paise',
    'gateway_tax_paise',
    'updated_at',
  ],
};

const REQUIRED_SCHEMA_INDEXES = [
  'orders_razorpay_payment_id_uidx',
  'orders_razorpay_order_id_uidx',
];

function isTableEmpty(state: {
  userCount: number;
  productCount: number;
  settingsCount: number;
}): boolean {
  return state.userCount === 0 && state.productCount === 0 && state.settingsCount === 0;
}

export class PostgresStateAdapter {
  private externalSchemaReady = false;
  private externalSchemaPromise: Promise<void> | null = null;
  private schemaVerificationCache: {
    ok: boolean;
    missingColumns: string[];
    missingIndexes: string[];
    checkedAt: string;
  } | null = null;

  /**
   * Lazily provisions the 12 relational tables ONLY if a brand-new external Postgres database
   * reports undefined_table (42P01). Never runs ALTER TABLE or CREATE INDEX during normal reads.
   */
  private async ensureExternalSchemaIfNeeded(): Promise<void> {
    if (this.externalSchemaReady || !isUsingExternalPostgresUrl()) return;
    if (this.externalSchemaPromise) {
      await this.externalSchemaPromise;
      return;
    }

    const startedAt = Date.now();
    this.externalSchemaPromise = (async () => {
      const pool = createPool();
      await pool.query(EXTERNAL_SCHEMA_DDL);
      this.externalSchemaReady = true;
      logStructured('info', 'cloud-sql', 'external_schema_bootstrapped', {
        durationMs: Date.now() - startedAt,
      });
    })().finally(() => {
      this.externalSchemaPromise = null;
    });

    await this.externalSchemaPromise;
  }

  /**
   * Read-only verification of required columns and idempotency indexes via system catalogs.
   * Safe for least-privilege application database roles — never executes DDL.
   */
  async verifyRequiredSchema(force = false): Promise<{
    ok: boolean;
    missingColumns: string[];
    missingIndexes: string[];
    checkedAt: string;
  }> {
    if (this.schemaVerificationCache && !force) {
      return this.schemaVerificationCache;
    }
    const pool = createPool();
    const [colRes, idxRes] = await Promise.all([
      pool.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('orders', 'payment_intents')`
      ),
      pool.query<{ indexname: string }>(
        `SELECT indexname
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'orders'`
      ),
    ]);

    const existingCols = new Set(colRes.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const existingIdxs = new Set(idxRes.rows.map((r) => r.indexname));

    const missingColumns: string[] = [];
    for (const [table, cols] of Object.entries(REQUIRED_SCHEMA_COLUMNS)) {
      for (const col of cols) {
        if (!existingCols.has(`${table}.${col}`)) {
          missingColumns.push(`${table}.${col}`);
        }
      }
    }
    const missingIndexes = REQUIRED_SCHEMA_INDEXES.filter((idx) => !existingIdxs.has(idx));

    const summary = {
      ok: missingColumns.length === 0 && missingIndexes.length === 0,
      missingColumns,
      missingIndexes,
      checkedAt: new Date().toISOString(),
    };
    this.schemaVerificationCache = summary;
    return summary;
  }

  private connectionIdentityCache: {
    host?: string;
    port?: number;
    sourceEnvVar?: string;
    provider: string;
    runtimeEnv: string;
    databaseName?: string;
    currentSchema?: string;
    searchPath?: string;
  } | null = null;

  /**
   * Read-only diagnostic lookup of connected DB identity (host, database name, current_schema, search_path).
   * Safe for server-side logs only — never exposes credentials, usernames, or connection strings.
   */
  private async getSafeConnectionDiagnostics(): Promise<{
    host?: string;
    port?: number;
    sourceEnvVar?: string;
    provider: string;
    runtimeEnv: string;
    databaseName?: string;
    currentSchema?: string;
    searchPath?: string;
  }> {
    if (this.connectionIdentityCache) return this.connectionIdentityCache;
    const envInfo = getDatabaseEnvironmentInfo();
    const base = {
      host: envInfo.host,
      port: envInfo.port,
      sourceEnvVar: envInfo.sourceEnvVar,
      provider: envInfo.provider,
      runtimeEnv: envInfo.runtimeEnv,
      databaseName: envInfo.databaseName,
    };
    try {
      const pool = createPool();
      const res = await pool.query<{
        database_name: string;
        current_schema: string;
        search_path: string;
      }>(
        `SELECT current_database() AS database_name,
                current_schema() AS current_schema,
                current_setting('search_path') AS search_path`
      );
      const row = res.rows[0];
      const identity = {
        ...base,
        databaseName: row?.database_name || base.databaseName,
        currentSchema: row?.current_schema,
        searchPath: row?.search_path,
      };
      this.connectionIdentityCache = identity;
      return identity;
    } catch {
      return base;
    }
  }

  /**
   * Executes a Postgres operation without runtime ALTER TABLE / CREATE INDEX DDL.
   * Retries once on transient idle-socket resets (common when Neon compute wakes from scale-to-zero).
   */
  private async runWithRecovery<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isUsingExternalPostgresUrl() && isUndefinedTableError(error)) {
        await this.ensureExternalSchemaIfNeeded();
        return await operation();
      }
      if (isUndefinedColumnError(error)) {
        const dbIdentity = await this.getSafeConnectionDiagnostics();
        logStructured('error', 'cloud-sql', 'schema_migration_required', {
          ...extractPgDiagnostics(error),
          dbHost: dbIdentity.host,
          dbPort: dbIdentity.port,
          dbName: dbIdentity.databaseName,
          dbSchema: dbIdentity.currentSchema,
          searchPath: dbIdentity.searchPath,
          dbSourceEnvVar: dbIdentity.sourceEnvVar,
          dbProvider: dbIdentity.provider,
          runtimeEnv: dbIdentity.runtimeEnv,
          hint: 'Run database schema migration using the authorized database owner role.',
        });
        throw error;
      }
      if (isTransientConnectionError(error)) {
        logStructured('warn', 'cloud-sql', 'transient_connection_retry', {
          code: getPgErrorCode(error) || 'connection_reset',
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
  async loadPublicBootstrap(): Promise<{
    empty: boolean;
    data: PublicBootstrapDbData;
    dbMs: number;
  }> {
    const startedAt = Date.now();
    try {
      const result = await this.runWithRecovery(async () => {
        const pool = createPool();
        return pool.query<{
          products: Record<string, unknown>[];
          coupons: Record<string, unknown>[];
          promotions: Record<string, unknown>[];
          lab_reports: Record<string, unknown>[];
          cms_sections: Record<string, unknown>[];
          settings: StoreSettings | null;
        }>(`
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
      const rawSettings = (row?.settings ?? null) as StoreSettings | null;

      if (rawProducts.length === 0 && !rawSettings) {
        return {
          empty: true,
          data: {
            products: [],
            settings: null,
            coupons: [],
            promotions: [],
            labReports: [],
            cmsSections: [],
          },
          dbMs,
        };
      }

      const mappedProducts: Product[] = rawProducts.map((r) => ({
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
        specifications: Array.isArray(r.specifications)
          ? (r.specifications as Product['specifications'])
          : [],
        galleryTypes: Array.isArray(r.gallery_types)
          ? (r.gallery_types as Product['galleryTypes'])
          : [],
        customImages: Array.isArray(r.custom_images)
          ? (r.custom_images as string[])
          : undefined,
        active: Boolean(r.active),
      }));

      const mappedCoupons: Coupon[] = rawCoupons.map((r) => ({
        code: String(r.code),
        discountType: r.type === 'flat' ? 'flat' : 'percent',
        value: Number(r.value),
        minOrderAmount: Number(r.min_order_value),
        active: Boolean(r.active),
        description: String(r.description),
      }));

      const mappedPromotions: Promotion[] = rawPromotions.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        description: String(r.description),
        bannerHeadline: String(r.banner_headline),
        bannerSubtext: String(r.banner_subtext),
        bannerTheme: r.banner_theme as BannerTheme,
        startsAt: String(r.starts_at),
        endsAt: String(r.ends_at),
        freeShipping: Boolean(r.free_shipping),
        freeShippingSpeed: r.free_shipping_speed === 'all' ? 'all' : 'standard',
        discountPercent: Number(r.discount_percent),
        promoCode: r.promo_code ? String(r.promo_code) : undefined,
        enabled: Boolean(r.enabled),
        usageCount: Number(r.usage_count),
        revenueGenerated: Number(r.revenue_generated),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      }));

      const mappedLabReports: LabReport[] = rawLabReports.map((r) => ({
        id: String(r.id),
        laboratoryName: String(r.laboratory_name),
        reportNumber: String(r.report_number),
        testedBatchNumber: String(r.tested_batch_number),
        testDate: String(r.test_date),
        mappedProductIds: Array.isArray(r.mapped_product_ids)
          ? (r.mapped_product_ids as string[])
          : [],
        testingMethodology: String(r.testing_methodology || r.accreditation || ''),
        verifiedStatus:
          r.verified_status === 'Verified' || r.verified_status === 'Pending Verification'
            ? r.verified_status
            : 'Reference Sample',
        notes: String(r.notes || r.summary_note || ''),
        customDocumentUrl: r.custom_document_url ? String(r.custom_document_url) : undefined,
        originalFileName: r.original_file_name ? String(r.original_file_name) : undefined,
        originalMimeType: r.original_mime_type ? String(r.original_mime_type) : undefined,
        heavyMetals: Array.isArray(r.heavy_metals)
          ? (r.heavy_metals as LabReport['heavyMetals'])
          : [],
        microbiological: Array.isArray(r.microbiological)
          ? (r.microbiological as LabReport['microbiological'])
          : [],
        updatedAt: String(r.updated_at || r.test_date),
      }));

      const mappedCms: CmsSection[] = rawCms.map((r) => ({
        id: String(r.id),
        key: String(r.key),
        title: String(r.title),
        category: r.category === 'faq' ? 'faq' : 'product',
        content: String(r.content),
        approvedByAdmin: Boolean(r.approved_by_admin),
        approvedAt: r.approved_at ? String(r.approved_at) : undefined,
        updatedAt: String(r.updated_at),
      }));

      return {
        empty: false,
        data: {
          products: mappedProducts,
          settings: rawSettings,
          coupons: mappedCoupons,
          promotions: mappedPromotions,
          labReports: mappedLabReports,
          cmsSections: mappedCms,
        },
        dbMs,
      };
    } catch (error) {
      const dbIdentity = await this.getSafeConnectionDiagnostics();
      logStructured('error', 'cloud-sql', 'load_public_bootstrap_failed', {
        durationMs: Date.now() - startedAt,
        ...extractPgDiagnostics(error),
        dbHost: dbIdentity.host,
        dbPort: dbIdentity.port,
        dbName: dbIdentity.databaseName,
        dbSchema: dbIdentity.currentSchema,
        searchPath: dbIdentity.searchPath,
        dbSourceEnvVar: dbIdentity.sourceEnvVar,
        dbProvider: dbIdentity.provider,
        runtimeEnv: dbIdentity.runtimeEnv,
      });
      throw error;
    }
  }

  private mapUserRow(row: typeof users.$inferSelect): StoredUser {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role === 'admin' ? 'admin' : 'customer',
      passwordHash: row.passwordHash,
      defaultAddress: row.defaultAddress ?? undefined,
      wishlistProductIds: Array.isArray(row.wishlistProductIds) ? row.wishlistProductIds : [],
      createdAt: row.createdAt,
    };
  }

  private mapProductRow(row: typeof products.$inferSelect): Product {
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
      customImages: Array.isArray(row.customImages) ? row.customImages : undefined,
      active: row.active,
    };
  }

  private mapOrderRow(row: typeof orders.$inferSelect): Order {
    return {
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
      gatewayTaxAmount: row.gatewayTaxAmount ?? undefined,
      gatewayFeeSource:
        row.gatewayFeeSource === 'razorpay_actual' || row.gatewayFeeSource === 'estimated'
          ? row.gatewayFeeSource
          : undefined,
      actualShippingCost: row.actualShippingCost ?? undefined,
      paymentMethod: row.paymentMethod as PaymentMethod,
      paymentStatus: row.paymentStatus as OrderPaymentStatus,
      settlementStatus: (row.settlementStatus as PaymentSettlementStatus | null) ?? undefined,
      razorpaySettlementId: row.razorpaySettlementId ?? undefined,
      settledAt: row.settledAt ?? undefined,
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
    };
  }

  private mapPaymentIntentRow(row: typeof paymentIntents.$inferSelect): PaymentIntentRecord {
    return {
      razorpayOrderId: row.razorpayOrderId,
      amountPaise: row.amountPaise,
      verified: row.verified,
      paymentId: row.paymentId ?? undefined,
      signatureVerified: row.signatureVerified,
      method: row.method,
      checkoutPayload: row.checkoutPayload ?? undefined,
      orderId: row.orderId ?? undefined,
      gatewayFeePaise: row.gatewayFeePaise ?? undefined,
      gatewayTaxPaise: row.gatewayTaxPaise ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? undefined,
    };
  }

  /**
   * Targeted single-row upsert for a Razorpay payment intent.
   * Preserves checkoutPayload & orderId across partial updates so webhook recovery always has checkout details.
   */
  async upsertPaymentIntent(intent: PaymentIntentRecord): Promise<void> {
    const startedAt = Date.now();
    const updatedAt = intent.updatedAt ?? new Date().toISOString();
    try {
      await this.runWithRecovery(() =>
        db
          .insert(paymentIntents)
          .values({
            razorpayOrderId: intent.razorpayOrderId,
            amountPaise: intent.amountPaise,
            verified: intent.verified,
            paymentId: intent.paymentId ?? null,
            signatureVerified: intent.signatureVerified,
            method: intent.method,
            checkoutPayload: intent.checkoutPayload ?? null,
            orderId: intent.orderId ?? null,
            gatewayFeePaise: intent.gatewayFeePaise ?? null,
            gatewayTaxPaise: intent.gatewayTaxPaise ?? null,
            createdAt: intent.createdAt,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: paymentIntents.razorpayOrderId,
            set: {
              amountPaise: intent.amountPaise,
              verified: intent.verified,
              paymentId: intent.paymentId ?? null,
              signatureVerified: intent.signatureVerified,
              method: intent.method,
              ...(intent.checkoutPayload !== undefined
                ? { checkoutPayload: intent.checkoutPayload ?? null }
                : {}),
              ...(intent.orderId !== undefined ? { orderId: intent.orderId ?? null } : {}),
              ...(intent.gatewayFeePaise !== undefined
                ? { gatewayFeePaise: intent.gatewayFeePaise ?? null }
                : {}),
              ...(intent.gatewayTaxPaise !== undefined
                ? { gatewayTaxPaise: intent.gatewayTaxPaise ?? null }
                : {}),
              updatedAt,
            },
          })
      );
      logStructured('info', 'cloud-sql', 'upsert_payment_intent_success', {
        verified: intent.verified,
        hasCheckoutDraft: Boolean(intent.checkoutPayload),
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logStructured('error', 'cloud-sql', 'upsert_payment_intent_failed', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Unable to save payment session right now. Please try again.', {
        code: 'POSTGRES_PAYMENT_INTENT_WRITE_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  /**
   * Targeted single-row lookup for a Razorpay payment intent by razorpayOrderId.
   */
  async findPaymentIntent(razorpayOrderId: string): Promise<PaymentIntentRecord | null> {
    const startedAt = Date.now();
    try {
      const rows = await this.runWithRecovery(() =>
        db
          .select()
          .from(paymentIntents)
          .where(eq(paymentIntents.razorpayOrderId, razorpayOrderId))
          .limit(1)
      );
      logStructured('info', 'cloud-sql', 'find_payment_intent_success', {
        found: rows.length > 0,
        durationMs: Date.now() - startedAt,
      });
      return rows[0] ? this.mapPaymentIntentRow(rows[0]) : null;
    } catch (error) {
      logStructured('error', 'cloud-sql', 'find_payment_intent_failed', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Unable to verify payment session right now. Please try again.', {
        code: 'POSTGRES_PAYMENT_INTENT_READ_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async findOrderByRazorpayReference(params: {
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
  }): Promise<Order | null> {
    if (!params.razorpayOrderId && !params.razorpayPaymentId) return null;
    const rows = await this.runWithRecovery(() =>
      db
        .select()
        .from(orders)
        .where(
          params.razorpayPaymentId && params.razorpayOrderId
            ? or(
                eq(orders.razorpayPaymentId, params.razorpayPaymentId),
                eq(orders.razorpayOrderId, params.razorpayOrderId)
              )
            : params.razorpayPaymentId
            ? eq(orders.razorpayPaymentId, params.razorpayPaymentId)
            : eq(orders.razorpayOrderId, params.razorpayOrderId!)
        )
        .limit(1)
    );
    return rows[0] ? this.mapOrderRow(rows[0]) : null;
  }

  async findOrdersForUser(userId: string, email: string): Promise<Order[]> {
    const normalizedEmail = email.trim().toLowerCase();
    const rows = await this.runWithRecovery(() =>
      db
        .select()
        .from(orders)
        .where(
          or(
            eq(orders.userId, userId),
            sql`lower(${orders.customerEmail}) = ${normalizedEmail}`
          )
        )
        .orderBy(desc(orders.createdAt))
    );
    return rows.map((row) => this.mapOrderRow(row));
  }

  async listUnreconciledCapturedIntents(): Promise<PaymentIntentRecord[]> {
    const [intentRows, orderRows] = await this.runWithRecovery(() =>
      Promise.all([
        db
          .select()
          .from(paymentIntents)
          .where(
            or(
              eq(paymentIntents.verified, true),
              sql`${paymentIntents.paymentId} IS NOT NULL`
            )
          )
          .orderBy(desc(paymentIntents.createdAt)),
        db
          .select({
            id: orders.id,
            razorpayOrderId: orders.razorpayOrderId,
            razorpayPaymentId: orders.razorpayPaymentId,
          })
          .from(orders),
      ])
    );

    const matchedOrderIds = new Set(orderRows.map((o) => o.id));
    const matchedRzpOrderIds = new Set(
      orderRows.map((o) => o.razorpayOrderId).filter((v): v is string => Boolean(v))
    );
    const matchedRzpPaymentIds = new Set(
      orderRows.map((o) => o.razorpayPaymentId).filter((v): v is string => Boolean(v))
    );

    return intentRows
      .filter(
        (intent) =>
          !(intent.orderId && matchedOrderIds.has(intent.orderId)) &&
          !matchedRzpOrderIds.has(intent.razorpayOrderId) &&
          !(intent.paymentId && matchedRzpPaymentIds.has(intent.paymentId))
      )
      .map((row) => this.mapPaymentIntentRow(row));
  }

  /**
   * Targeted read-only query for Admin Live Checkout Activity.
   * Reads fresh Neon PostgreSQL payment_intents (with checkout_payload), linked orders, and catalog products.
   */
  async listCheckoutActivitySources(limit = 200): Promise<{
    intents: PaymentIntentRecord[];
    orders: Order[];
    products: Product[];
  }> {
    const startedAt = Date.now();
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 200, 1), 500);
    try {
      const [intentRows, orderRows, productRows] = await this.runWithRecovery(() =>
        Promise.all([
          db
            .select()
            .from(paymentIntents)
            .orderBy(desc(paymentIntents.createdAt))
            .limit(safeLimit),
          db.select().from(orders).orderBy(desc(orders.createdAt)),
          db.select().from(products),
        ])
      );
      logStructured('info', 'cloud-sql', 'list_checkout_activity_success', {
        intentCount: intentRows.length,
        orderCount: orderRows.length,
        durationMs: Date.now() - startedAt,
      });
      return {
        intents: intentRows.map((row) => this.mapPaymentIntentRow(row)),
        orders: orderRows.map((row) => this.mapOrderRow(row)),
        products: productRows.map((row) => this.mapProductRow(row)),
      };
    } catch (error) {
      const pgDiag = extractPgDiagnostics(error);
      const connDiag = await this.getSafeConnectionDiagnostics();
      logStructured('error', 'cloud-sql', 'list_checkout_activity_failed', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        ...pgDiag,
        ...connDiag,
      });
      throw new StorePersistenceError('Unable to load live checkout activity right now.', {
        code: 'POSTGRES_CHECKOUT_ACTIVITY_READ_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async cleanupApprovedTestRecords(params: {
    orderIds: string[];
    paymentIntentIds: string[];
    notificationIds: string[];
    restoreInventory: boolean;
  }): Promise<{
    deletedOrderNumbers: string[];
    deletedPaymentIntentIds: string[];
    deletedNotificationIds: string[];
    restoredStock: Array<{ productId: string; quantityRestored: number; newStock: number }>;
  }> {
    return this.runWithRecovery(() =>
      db.transaction(async (tx) => {
        const deletedOrderNumbers: string[] = [];
        const restoredStock: Array<{ productId: string; quantityRestored: number; newStock: number }> =
          [];
        const stockRestoreMap = new Map<string, number>();

        for (const orderId of params.orderIds) {
          const found = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, orderId))
            .limit(1);
          if (!found[0]) continue;
          const ord = this.mapOrderRow(found[0]);
          if (
            params.restoreInventory &&
            ord.status !== 'Cancelled' &&
            ord.status !== 'Refunded'
          ) {
            for (const item of ord.items) {
              stockRestoreMap.set(
                item.productId,
                (stockRestoreMap.get(item.productId) ?? 0) + item.quantity
              );
            }
          }
          await tx.delete(orders).where(eq(orders.id, orderId));
          deletedOrderNumbers.push(ord.orderNumber);
        }

        for (const [productId, qty] of stockRestoreMap.entries()) {
          if (qty <= 0) continue;
          const updated = await tx
            .update(products)
            .set({
              stock: sql`${products.stock} + ${qty}`,
              updatedAt: new Date(),
            })
            .where(eq(products.id, productId))
            .returning({ id: products.id, stock: products.stock });
          if (updated[0]) {
            restoredStock.push({
              productId: updated[0].id,
              quantityRestored: qty,
              newStock: updated[0].stock,
            });
          }
        }

        const deletedPaymentIntentIds: string[] = [];
        for (const intentId of params.paymentIntentIds) {
          const del = await tx
            .delete(paymentIntents)
            .where(eq(paymentIntents.razorpayOrderId, intentId))
            .returning({ id: paymentIntents.razorpayOrderId });
          if (del[0]) deletedPaymentIntentIds.push(del[0].id);
        }

        const deletedNotificationIds: string[] = [];
        for (const notifId of params.notificationIds) {
          const del = await tx
            .delete(adminNotifications)
            .where(eq(adminNotifications.id, notifId))
            .returning({ id: adminNotifications.id });
          if (del[0]) deletedNotificationIds.push(del[0].id);
        }

        // Recalculate promotion usage_count and revenue_generated from remaining legitimate confirmed orders
        const [remainingOrderRows, currentPromoRows] = await Promise.all([
          tx.select().from(orders),
          tx.select().from(promotions),
        ]);
        const mappedRemainingOrders = remainingOrderRows.map((r) => this.mapOrderRow(r));
        const mappedCurrentPromos: Promotion[] = currentPromoRows.map((row) => ({
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
        const promoSync = recalculatePromotionAndCouponAnalytics(
          mappedCurrentPromos,
          [],
          mappedRemainingOrders
        );
        const nowIso = new Date().toISOString();
        for (const recalcPromo of promoSync.recalculatedPromotions) {
          await tx
            .update(promotions)
            .set({
              usageCount: recalcPromo.usageCount,
              revenueGenerated: recalcPromo.revenueGenerated,
              updatedAt: nowIso,
            })
            .where(eq(promotions.id, recalcPromo.id));
        }

        return {
          deletedOrderNumbers,
          deletedPaymentIntentIds,
          deletedNotificationIds,
          restoredStock,
        };
      })
    );
  }

  /**
   * Atomically recalculates promotions.usage_count and promotions.revenue_generated from
   * legitimate confirmed orders in PostgreSQL while preserving all active offers, discounts,
   * schedules, and free-shipping settings.
   */
  async recalculatePromotionsFromConfirmedOrders(): Promise<{
    previousTotalRedemptions: number;
    previousTotalRevenue: number;
    recalculatedTotalRedemptions: number;
    recalculatedTotalRevenue: number;
    updatedPromotionsCount: number;
  }> {
    return this.runWithRecovery(() =>
      db.transaction(async (tx) => {
        const [orderRows, promoRows] = await Promise.all([
          tx.select().from(orders),
          tx.select().from(promotions),
        ]);
        const mappedOrders = orderRows.map((r) => this.mapOrderRow(r));
        const mappedPromos: Promotion[] = promoRows.map((row) => ({
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

        const { recalculatedPromotions, audit } = recalculatePromotionAndCouponAnalytics(
          mappedPromos,
          [],
          mappedOrders
        );
        const nowIso = new Date().toISOString();
        let updatedPromotionsCount = 0;

        for (const promo of recalculatedPromotions) {
          await tx
            .update(promotions)
            .set({
              usageCount: promo.usageCount,
              revenueGenerated: promo.revenueGenerated,
              updatedAt: nowIso,
            })
            .where(eq(promotions.id, promo.id));
          updatedPromotionsCount += 1;
        }

        return {
          previousTotalRedemptions: audit.storedTotalRedemptions,
          previousTotalRevenue: audit.storedTotalRevenue,
          recalculatedTotalRedemptions: audit.computedTotalRedemptions,
          recalculatedTotalRevenue: audit.computedTotalRevenue,
          updatedPromotionsCount,
        };
      })
    );
  }

  /**
   * Loads only the minimal tables required for checkout pricing, stock validation,
   * payment intent verification, order idempotency, and next order sequence numbering.
   * Skips users, all historical orders, lab_reports, cms_sections, expenses, inquiries, and notifications.
   */
  async loadCheckoutContext(params?: {
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    includeOrderSequence?: boolean;
  }): Promise<PostgresCheckoutContext> {
    const startedAt = Date.now();
    try {
      const [
        productRows,
        couponRows,
        promotionRows,
        settingsRows,
        intentRows,
        existingOrderRows,
        seqResult,
      ] = await this.runWithRecovery(() =>
        Promise.all([
          db.select().from(products).orderBy(asc(products.sortOrder)),
          db.select().from(coupons).orderBy(asc(coupons.sortOrder)),
          db.select().from(promotions).orderBy(asc(promotions.sortOrder)),
          db.select().from(storeSettings).where(eq(storeSettings.id, 'default')).limit(1),
          params?.razorpayOrderId
            ? db
                .select()
                .from(paymentIntents)
                .where(eq(paymentIntents.razorpayOrderId, params.razorpayOrderId))
                .limit(1)
            : Promise.resolve([]),
          params?.razorpayPaymentId || params?.razorpayOrderId
            ? db
                .select()
                .from(orders)
                .where(
                  params.razorpayPaymentId && params.razorpayOrderId
                    ? or(
                        eq(orders.razorpayPaymentId, params.razorpayPaymentId),
                        eq(orders.razorpayOrderId, params.razorpayOrderId)
                      )
                    : params.razorpayPaymentId
                    ? eq(orders.razorpayPaymentId, params.razorpayPaymentId)
                    : eq(orders.razorpayOrderId, params.razorpayOrderId!)
                )
                .limit(1)
            : Promise.resolve([]),
          params?.includeOrderSequence
            ? db.execute(
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
              )
            : Promise.resolve(null),
        ])
      );

      const rawSeqRow =
        seqResult && Array.isArray((seqResult as { rows?: unknown[] }).rows)
          ? ((seqResult as { rows: Array<{ max_seq?: number | string }> }).rows[0] ?? null)
          : null;
      const maxOrderSeq = Number(rawSeqRow?.max_seq ?? 0) || 0;

      const mappedProducts = productRows.map((row) => this.mapProductRow(row));
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

      logStructured('info', 'cloud-sql', 'load_checkout_context_success', {
        productCount: mappedProducts.length,
        hasIntent: intentRows.length > 0,
        hasExistingOrder: existingOrderRows.length > 0,
        durationMs: Date.now() - startedAt,
      });

      return {
        empty: mappedProducts.length === 0 && settingsRows.length === 0,
        products: mappedProducts,
        coupons: mappedCoupons,
        promotions: mappedPromotions,
        settings: settingsRows[0]?.payload ?? null,
        paymentIntent: intentRows[0] ? this.mapPaymentIntentRow(intentRows[0]) : null,
        existingOrderByPayment: existingOrderRows[0]
          ? this.mapOrderRow(existingOrderRows[0])
          : null,
        maxOrderSeq,
      };
    } catch (error) {
      const dbIdentity = await this.getSafeConnectionDiagnostics();
      logStructured('error', 'cloud-sql', 'load_checkout_context_failed', {
        durationMs: Date.now() - startedAt,
        ...extractPgDiagnostics(error),
        dbHost: dbIdentity.host,
        dbName: dbIdentity.databaseName,
        searchPath: dbIdentity.searchPath,
        dbSourceEnvVar: dbIdentity.sourceEnvVar,
      });
      throw new StorePersistenceError('Database read failed during checkout. Please try again shortly.', {
        code: 'POSTGRES_CHECKOUT_READ_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    try {
      const normalized = email.trim().toLowerCase();
      const rows = await this.runWithRecovery(() =>
        db.select().from(users).where(eq(users.email, normalized)).limit(1)
      );
      return rows[0] ? this.mapUserRow(rows[0]) : null;
    } catch (error) {
      const dbIdentity = await this.getSafeConnectionDiagnostics();
      logStructured('error', 'cloud-sql', 'find_user_by_email_failed', {
        ...extractPgDiagnostics(error),
        dbHost: dbIdentity.host,
        dbName: dbIdentity.databaseName,
        searchPath: dbIdentity.searchPath,
        dbSourceEnvVar: dbIdentity.sourceEnvVar,
      });
      throw new StorePersistenceError('Database read failed. Please try again shortly.', {
        code: 'POSTGRES_READ_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    try {
      const rows = await this.runWithRecovery(() =>
        db.select().from(users).where(eq(users.id, id)).limit(1)
      );
      return rows[0] ? this.mapUserRow(rows[0]) : null;
    } catch (error) {
      const dbIdentity = await this.getSafeConnectionDiagnostics();
      logStructured('error', 'cloud-sql', 'find_user_by_id_failed', {
        ...extractPgDiagnostics(error),
        dbHost: dbIdentity.host,
        dbName: dbIdentity.databaseName,
        searchPath: dbIdentity.searchPath,
        dbSourceEnvVar: dbIdentity.sourceEnvVar,
      });
      throw new StorePersistenceError('Database read failed. Please try again shortly.', {
        code: 'POSTGRES_READ_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  /**
   * Fast, atomic single-row user save (~20ms) that avoids full 12-table rewrites and
   * eliminates unique email/uid constraint race conditions during Google & Email sign-in.
   */
  async upsertUser(user: StoredUser, uid?: string): Promise<StoredUser> {
    const startedAt = Date.now();
    const normalizedEmail = user.email.trim().toLowerCase();
    try {
      const rows = await this.runWithRecovery(() =>
        db
          .insert(users)
          .values({
            id: user.id,
            ...(uid ? { uid } : {}),
            name: user.name,
            email: normalizedEmail,
            phone: user.phone ?? '',
            role: user.role,
            passwordHash: user.passwordHash,
            defaultAddress: user.defaultAddress ?? null,
            wishlistProductIds: user.wishlistProductIds ?? [],
            createdAt: user.createdAt,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: users.email,
            set: {
              ...(uid ? { uid } : {}),
              name: user.name,
              phone: user.phone ?? '',
              role: user.role,
              defaultAddress: user.defaultAddress ?? null,
              wishlistProductIds: user.wishlistProductIds ?? [],
              updatedAt: new Date(),
            },
          })
          .returning()
      );

      logStructured('info', 'cloud-sql', 'upsert_user_success', {
        durationMs: Date.now() - startedAt,
      });

      return rows[0] ? this.mapUserRow(rows[0]) : { ...user, email: normalizedEmail };
    } catch (error) {
      logStructured('error', 'cloud-sql', 'upsert_user_failed', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Database save failed. Please try again shortly.', {
        code: 'POSTGRES_USER_WRITE_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  /**
   * Atomically inserts a new email/password customer; returns null if the email already exists.
   */
  async createUserIfNotExists(user: StoredUser): Promise<StoredUser | null> {
    const startedAt = Date.now();
    const normalizedEmail = user.email.trim().toLowerCase();
    try {
      const rows = await this.runWithRecovery(() =>
        db
          .insert(users)
          .values({
            id: user.id,
            name: user.name,
            email: normalizedEmail,
            phone: user.phone ?? '',
            role: user.role,
            passwordHash: user.passwordHash,
            defaultAddress: user.defaultAddress ?? null,
            wishlistProductIds: user.wishlistProductIds ?? [],
            createdAt: user.createdAt,
            updatedAt: new Date(),
          })
          .onConflictDoNothing({ target: users.email })
          .returning()
      );

      logStructured('info', 'cloud-sql', 'create_user_attempt', {
        durationMs: Date.now() - startedAt,
        created: rows.length > 0,
      });

      return rows[0] ? this.mapUserRow(rows[0]) : null;
    } catch (error) {
      logStructured('error', 'cloud-sql', 'create_user_failed', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Database save failed. Please try again shortly.', {
        code: 'POSTGRES_USER_WRITE_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async loadState(getFallbackSeed: DatabaseState | (() => DatabaseState)): Promise<{
    empty: boolean;
    state: DatabaseState;
    dbMs: number;
  }> {
    const startedAt = Date.now();
    const resolveFallbackSeed = () =>
      typeof getFallbackSeed === 'function' ? getFallbackSeed() : getFallbackSeed;
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
      ] = await this.runWithRecovery(() =>
        Promise.all([
          db.select().from(users).orderBy(asc(users.createdAt)),
          db.select().from(products).orderBy(asc(products.sortOrder)),
          db.select().from(orders).orderBy(asc(orders.sortOrder), desc(orders.createdAt)),
          db.select().from(coupons).orderBy(asc(coupons.sortOrder)),
          db.select().from(promotions).orderBy(asc(promotions.sortOrder)),
          db.select().from(labReports).orderBy(asc(labReports.sortOrder)),
          db.select().from(cmsSections).orderBy(asc(cmsSections.sortOrder)),
          db.select().from(expenses).orderBy(asc(expenses.sortOrder)),
          db.select().from(inquiries).orderBy(asc(inquiries.sortOrder)),
          db
            .select()
            .from(adminNotifications)
            .orderBy(asc(adminNotifications.sortOrder), desc(adminNotifications.createdAt)),
          db.select().from(paymentIntents),
          db.select().from(storeSettings).where(eq(storeSettings.id, 'default')).limit(1),
        ])
      );

      if (
        isTableEmpty({
          userCount: userRows.length,
          productCount: productRows.length,
          settingsCount: settingsRows.length,
        })
      ) {
        return { empty: true, state: resolveFallbackSeed(), dbMs: Date.now() - startedAt };
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

      const mappedOrders: Order[] = orderRows.map((row) => this.mapOrderRow(row));

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
        mappedIntents[row.razorpayOrderId] = this.mapPaymentIntentRow(row);
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
          paymentIntents: mappedIntents,
        },
        dbMs: Date.now() - startedAt,
      };
    } catch (error) {
      const dbIdentity = await this.getSafeConnectionDiagnostics();
      logStructured('error', 'cloud-sql', 'load_state_failed', {
        ...extractPgDiagnostics(error),
        dbHost: dbIdentity.host,
        dbName: dbIdentity.databaseName,
        dbSchema: dbIdentity.currentSchema,
        searchPath: dbIdentity.searchPath,
        dbSourceEnvVar: dbIdentity.sourceEnvVar,
        dbProvider: dbIdentity.provider,
        runtimeEnv: dbIdentity.runtimeEnv,
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
    promotionUpdate?: { promotionId: string; revenueDelta: number };
    adminNotification?: AdminNotification;
    userDefaultAddressUpdate?: { userId: string; address: ShippingAddress };
  }): Promise<{ existingOrder?: Order; updatedProducts: Array<{ id: string; stock: number }> }> {
    const startedAt = Date.now();
    try {
      const txResult = await this.runWithRecovery(() =>
        db.transaction(async (tx) => {
        const o = params.order;

        // In-transaction idempotency guard: prevent duplicate orders or double stock decrement on parallel retries
        if (o.paymentMethod !== 'COD' && (o.razorpayPaymentId || o.razorpayOrderId)) {
          const dupCondition =
            o.razorpayPaymentId && o.razorpayOrderId
              ? or(
                  eq(orders.razorpayPaymentId, o.razorpayPaymentId),
                  eq(orders.razorpayOrderId, o.razorpayOrderId)
                )
              : o.razorpayPaymentId
              ? eq(orders.razorpayPaymentId, o.razorpayPaymentId)
              : eq(orders.razorpayOrderId, o.razorpayOrderId!);

          const existingRows = await tx.select().from(orders).where(dupCondition).limit(1);
          if (existingRows[0]) {
            return {
              existingOrder: this.mapOrderRow(existingRows[0]),
              updatedProducts: [] as Array<{ id: string; stock: number }>,
            };
          }
        }

        const updatedProducts: Array<{ id: string; stock: number }> = [];
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
          updatedProducts.push(updated[0]);
        }

        // Verify userId exists before FK insert so an unknown/stale session user never fails FK constraint
        let safeUserId: string | null = o.userId ?? null;
        if (safeUserId) {
          const foundUser = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, safeUserId))
            .limit(1);
          if (foundUser.length === 0) {
            safeUserId = null;
          }
        }

        // Shift sort_order or keep 0 (orders list sorts newest first / by sortOrder then createdAt)
        await tx
          .insert(orders)
          .values({
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
            gatewayTaxAmount: o.gatewayTaxAmount ?? null,
            gatewayFeeSource: o.gatewayFeeSource ?? null,
            actualShippingCost: o.actualShippingCost ?? null,
            paymentMethod: o.paymentMethod,
            paymentStatus: o.paymentStatus,
            settlementStatus: o.settlementStatus ?? null,
            razorpaySettlementId: o.razorpaySettlementId ?? null,
            settledAt: o.settledAt ?? null,
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

        if (o.razorpayOrderId) {
          await tx
            .update(paymentIntents)
            .set({
              orderId: o.id,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(paymentIntents.razorpayOrderId, o.razorpayOrderId));
        }

        if (params.promotionUpdate) {
          await tx
            .update(promotions)
            .set({
              usageCount: sql`${promotions.usageCount} + 1`,
              revenueGenerated: sql`${promotions.revenueGenerated} + ${params.promotionUpdate.revenueDelta}`,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(promotions.id, params.promotionUpdate.promotionId));
        }

        if (params.adminNotification) {
          const n = params.adminNotification;
          await tx
            .insert(adminNotifications)
            .values({
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
              createdAt: n.createdAt,
            })
            .onConflictDoNothing({ target: adminNotifications.id });
        }

        if (params.userDefaultAddressUpdate && safeUserId) {
          await tx
            .update(users)
            .set({
              defaultAddress: params.userDefaultAddressUpdate.address,
              updatedAt: new Date(),
            })
            .where(eq(users.id, safeUserId));
        }

        return { existingOrder: undefined, updatedProducts };
        })
      );

      logStructured('info', 'cloud-sql', 'transact_order_success', {
        orderId: params.order.id,
        orderNumber: params.order.orderNumber,
        idempotent: Boolean(txResult.existingOrder),
        durationMs: Date.now() - startedAt,
      });
      return txResult;
    } catch (error) {
      if (error instanceof StorePersistenceError) {
        throw error;
      }
      const pgCode = getPgErrorCode(error);
      // Handle concurrent unique-index race on razorpay_payment_id / razorpay_order_id idempotently
      if (
        pgCode === '23505' &&
        params.order.paymentMethod !== 'COD' &&
        (params.order.razorpayPaymentId || params.order.razorpayOrderId)
      ) {
        const existingOrder = await this.findOrderByRazorpayReference({
          razorpayOrderId: params.order.razorpayOrderId,
          razorpayPaymentId: params.order.razorpayPaymentId,
        }).catch(() => null);
        if (existingOrder) {
          logStructured('info', 'cloud-sql', 'transact_order_idempotent_race_recovered', {
            orderNumber: existingOrder.orderNumber,
            durationMs: Date.now() - startedAt,
          });
          return { existingOrder, updatedProducts: [] };
        }
      }
      logStructured('error', 'cloud-sql', 'transact_order_failed', {
        orderId: params.order.id,
        pgCode: pgCode || undefined,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new StorePersistenceError('Unable to confirm your order right now. Please try again.', {
        code: pgCode === '23505' ? 'ORDER_NUMBER_CONFLICT' : 'POSTGRES_TX_FAILED',
        statusCode: pgCode === '23505' ? 409 : 503,
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
      await this.runWithRecovery(() =>
        db.transaction(async (tx) => {
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

        // 2. Users (upsert safely by email before orders so foreign keys always resolve and concurrent sign-ups are never deleted)
        const userIds: string[] = [];
        for (const u of state.users) {
          const normalizedEmail = u.email.trim().toLowerCase();
          const savedRows = await tx
            .insert(users)
            .values({
              id: u.id,
              name: u.name,
              email: normalizedEmail,
              phone: u.phone,
              role: u.role,
              passwordHash: u.passwordHash,
              defaultAddress: u.defaultAddress ?? null,
              wishlistProductIds: u.wishlistProductIds ?? [],
              createdAt: u.createdAt,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: users.email,
              set: {
                name: u.name,
                phone: u.phone,
                role: u.role,
                defaultAddress: u.defaultAddress ?? null,
                wishlistProductIds: u.wishlistProductIds ?? [],
                updatedAt: new Date(),
              },
            })
            .returning({ id: users.id });
          userIds.push(savedRows[0]?.id ?? u.id);
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
              gatewayTaxAmount: o.gatewayTaxAmount ?? null,
              gatewayFeeSource: o.gatewayFeeSource ?? null,
              actualShippingCost: o.actualShippingCost ?? null,
              paymentMethod: o.paymentMethod,
              paymentStatus: o.paymentStatus,
              settlementStatus: o.settlementStatus ?? null,
              razorpaySettlementId: o.razorpaySettlementId ?? null,
              settledAt: o.settledAt ?? null,
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
                gatewayTaxAmount: o.gatewayTaxAmount ?? null,
                gatewayFeeSource: o.gatewayFeeSource ?? null,
                actualShippingCost: o.actualShippingCost ?? null,
                paymentMethod: o.paymentMethod,
                paymentStatus: o.paymentStatus,
                settlementStatus: o.settlementStatus ?? null,
                razorpaySettlementId: o.razorpaySettlementId ?? null,
                settledAt: o.settledAt ?? null,
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
              checkoutPayload: rec.checkoutPayload ?? null,
              orderId: rec.orderId ?? null,
              gatewayFeePaise: rec.gatewayFeePaise ?? null,
              gatewayTaxPaise: rec.gatewayTaxPaise ?? null,
              createdAt: rec.createdAt,
              updatedAt: rec.updatedAt ?? null,
            })
            .onConflictDoUpdate({
              target: paymentIntents.razorpayOrderId,
              set: {
                amountPaise: rec.amountPaise,
                verified: rec.verified,
                paymentId: rec.paymentId ?? null,
                signatureVerified: rec.signatureVerified,
                method: rec.method,
                checkoutPayload: rec.checkoutPayload ?? null,
                orderId: rec.orderId ?? null,
                gatewayFeePaise: rec.gatewayFeePaise ?? null,
                gatewayTaxPaise: rec.gatewayTaxPaise ?? null,
                updatedAt: rec.updatedAt ?? null,
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
        })
      );

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
