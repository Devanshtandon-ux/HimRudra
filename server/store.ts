import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AdminNotification,
  CmsSection,
  ContactInquiry,
  Coupon,
  Expense,
  LabReport,
  Order,
  Product,
  Promotion,
  PublicStoreBootstrap,
  ShippingAddress,
  StoreSettings,
  User,
} from '../src/types.ts';
import {
  FREE_SHIPPING_PROMO_END_ISO,
  getActivePromotions,
  normalizeLegacyOrderStatus,
} from '../src/lib/commerce.ts';
import {
  DynamoStateAdapter,
  buildItemFingerprint,
  computeDynamoDiff,
  deserializeDynamoItemsToState,
  getDynamoConfig,
  serializeStateToDynamoItems,
} from './dynamodb.ts';
import { isCloudSqlConfigured } from '../src/db/index.ts';
import { PostgresStateAdapter, type PostgresCheckoutContext } from '../src/db/postgresAdapter.ts';

export interface StoredUser extends User {
  passwordHash: string;
}

export interface PaymentIntentRecord {
  razorpayOrderId: string;
  amountPaise: number;
  verified: boolean;
  paymentId?: string;
  signatureVerified: boolean;
  method: string;
  createdAt: string;
}

export interface DatabaseState {
  users: StoredUser[];
  products: Product[];
  settings: StoreSettings;
  coupons: Coupon[];
  promotions: Promotion[];
  orders: Order[];
  labReports: LabReport[];
  cmsSections: CmsSection[];
  expenses: Expense[];
  inquiries: ContactInquiry[];
  adminNotifications: AdminNotification[];
  paymentIntents: Record<string, PaymentIntentRecord>;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export async function verifyPasswordAsync(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey)
    );
  });
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function getAdminOwnerEmail(): string {
  return (process.env.ADMIN_EMAIL || 'himrudraofficial@gmail.com').trim().toLowerCase();
}

function getInitialAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) {
    throw new Error('ADMIN_PASSWORD environment variable is required.');
  }
  return password;
}

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const BUNDLED_DATA_DIR = path.resolve(process.cwd(), 'data');
const BUNDLED_DB_FILE = path.join(BUNDLED_DATA_DIR, 'himrudra-db.json');
const DATA_DIR = IS_SERVERLESS ? path.join(os.tmpdir(), 'himrudra-data') : BUNDLED_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'himrudra-db.json');

function createSeedState(): DatabaseState {
  const now = new Date().toISOString();
  const ownerEmail = getAdminOwnerEmail();

  const users: StoredUser[] = [
    {
      id: 'usr-owner-1',
      name: 'Rahul Mewara (Store Owner)',
      email: ownerEmail,
      phone: '9549572457',
      role: 'admin',
      passwordHash: hashPassword(getInitialAdminPassword()),
      createdAt: '2026-08-01T08:00:00.000Z',
      wishlistProductIds: [],
    },
  ];

  const products: Product[] = [
    {
      id: 'himrudra-shilajit-20g',
      slug: 'himalayan-shilajit-resin-20g',
      name: 'HimRudra Himalayan Shilajit Resin',
      subtitle: 'Pure by Himalayas · 20 g Glass Apothecary Jar',
      netQuantity: '20 g',
      sku: 'HR-SHJ-20G',
      hsnCode: '30049011',
      mrp: 1299,
      price: 799,
      costPerUnit: 295,
      stock: 48,
      lowStockThreshold: 10,
      batchNumber: 'HR-SHJ-2026-B04',
      gstRatePercent: 12,
      shortDescription:
        'HimRudra Himalayan Shilajit Resin brings a traditional Himalayan wellness ingredient into a modern, premium experience. Presented in a 20 g jar, this resin is designed for customers who value thoughtful sourcing, clear product information and an uncomplicated daily routine.',
      usageGuidance:
        'Take a small amount using a normal spoon and dissolve completely in lukewarm water, warm milk, or herbal tea. Stir well until dissolved and consume once daily or as advised by a qualified practitioner.',
      storageInstructions:
        'Keep the amber glass jar tightly sealed after each use. Store in a cool, dry place away from direct sunlight. Resin consistency naturally firms in cooler weather and softens in warmth.',
      shippingNote:
        'Free standard pan-India delivery during our launch offer (until 30 November 2026). After the offer ends, standard delivery is ₹100 (3–5 business days). Cash on Delivery fee is ₹100.',
      returnPolicy:
        'Unopened, tamper-sealed jars are eligible for return or replacement within 7 days of delivery. Damaged-in-transit replacements are processed within 48 hours of photo verification.',
      specifications: [
        { label: 'Net Quantity', value: '20 g (approx. 40 servings)' },
        { label: 'Form', value: 'Semi-solid dark mineral resin' },
        { label: 'Container', value: 'UV-protected amber glass jar with brushed gold cap' },
        { label: 'Included Accessory', value: 'Normal measuring spoon' },
        { label: 'Active Batch Code', value: 'HR-SHJ-2026-B04' },
        { label: 'Shelf Life', value: '24 months from packaging date' },
      ],
      galleryTypes: ['hero', 'box', 'texture', 'ritual'],
      customImages: [
        '/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg',
        '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg',
      ],
      active: true,
    },
    {
      id: 'himrudra-shilajit-40g-duo',
      slug: 'himalayan-shilajit-resin-twin-ritual-pack',
      name: 'HimRudra Twin Ritual Pack (2 × 20 g)',
      subtitle: 'Two 20 g Apothecary Jars · Extended Daily Supply',
      netQuantity: '40 g (2 × 20 g)',
      sku: 'HR-SHJ-40G-DUO',
      hsnCode: '30049011',
      mrp: 2598,
      price: 1499,
      costPerUnit: 560,
      stock: 22,
      lowStockThreshold: 6,
      batchNumber: 'HR-SHJ-2026-B04',
      gstRatePercent: 12,
      shortDescription:
        'Two individually sealed 20 g jars of HimRudra Himalayan Shilajit Resin crafted for consistent two-to-four month household rituals.',
      usageGuidance:
        'Take a small amount using a normal spoon and dissolve completely in lukewarm water, warm milk, or herbal tea once daily. Keep the second jar sealed until ready to open.',
      storageInstructions:
        'Store in a cool, dry cabinet away from moisture and direct heat.',
      shippingNote:
        'Free standard pan-India delivery during our launch offer (until 30 November 2026). After the offer ends, standard delivery is ₹100. Cash on Delivery fee is ₹100.',
      returnPolicy:
        'Unopened jars with intact tamper seals qualify for return within 7 days of delivery.',
      specifications: [
        { label: 'Net Quantity', value: '40 g (Two 20 g jars)' },
        { label: 'Form', value: 'Traditional mineral-rich resin' },
        { label: 'Packaging', value: 'Dual keepsake boxes with 2 normal spoons' },
        { label: 'Active Batch Code', value: 'HR-SHJ-2026-B04' },
      ],
      galleryTypes: ['box', 'hero', 'texture', 'ritual'],
      customImages: [
        '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg',
        '/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg',
      ],
      active: true,
    },
  ];

  const settings: StoreSettings = {
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
    brandAddress:
      'Marketed by- KP Enterprise, Office No 4-D fourth, Vardan Exclusive, Tower, Lakhudi Rd, near SARDAR PATEL STADIUM, Navrangpura, Ahmedabad, Gujarat 380009',
    announcementText: 'LIMITED-TIME OFFER — FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!',
    seoTitle: 'HimRudra — Pure by Himalayas | Himalayan Shilajit Resin (20 g)',
    seoDescription:
      'Born in the Himalayas. Crafted for Your Ritual. Shop HimRudra Himalayan Shilajit Resin (20 g) with batch-level laboratory documentation.',
  };

  const coupons: Coupon[] = [
    {
      code: 'RITUAL10',
      discountType: 'percent',
      value: 10,
      minOrderAmount: 799,
      active: true,
      description: '10% privilege savings on orders ₹799+',
    },
    {
      code: 'HIMALAYA50',
      discountType: 'flat',
      value: 50,
      minOrderAmount: 799,
      active: true,
      description: 'Flat ₹50 off on single or twin pack orders',
    },
  ];

  const promotions: Promotion[] = [
    {
      id: 'promo-freeship-nov26',
      title: 'Limited-Time Free Shipping Offer',
      description: 'Free standard pan-India shipping on all orders placed before 1 December 2026.',
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
    },
  ];

  const orders: Order[] = [];

  const labReports: LabReport[] = [
    {
      id: 'lab-b04',
      laboratoryName: 'Eurofins Analytical Services (Reference Document Format)',
      reportNumber: 'COA-1026134',
      testedBatchNumber: '1026134',
      testDate: '2026-10-05',
      mappedProductIds: ['himrudra-shilajit-20g', 'himrudra-shilajit-40g-duo'],
      testingMethodology: 'Fulvic Acid Assay (77.15%), Heavy Metals & Microbiological Screening',
      verifiedStatus: 'Reference Sample',
      notes:
        'Reference Certificate of Analysis document attached for store review (Batch 1026134, Mfg. 10/2026, Exp. 09/2029). Kept unaltered as a reference format until the store owner uploads and marks an independently verifiable laboratory PDF as Verified.',
      customDocumentUrl: '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.56.54_PM__1__2115dbef.jpeg',
      heavyMetals: [
        {
          parameter: 'Fulvic Acid (Active Component)',
          method: 'Eurofins Assay',
          specificationLimit: 'Reference Batch',
          observedResult: '77.15%',
          status: 'Within Limit',
        },
        {
          parameter: 'Lead (Pb)',
          method: 'Reference COA',
          specificationLimit: 'NMT Specification',
          observedResult: 'Meets Specification (Pass)',
          status: 'Within Limit',
        },
        {
          parameter: 'Arsenic (As)',
          method: 'Reference COA',
          specificationLimit: 'NMT Specification',
          observedResult: 'Meets Specification (Pass)',
          status: 'Within Limit',
        },
        {
          parameter: 'Mercury (Hg)',
          method: 'Reference COA',
          specificationLimit: 'NMT Specification',
          observedResult: 'Meets Specification (Pass)',
          status: 'Within Limit',
        },
        {
          parameter: 'Cadmium (Cd)',
          method: 'Reference COA',
          specificationLimit: 'NMT Specification',
          observedResult: 'Meets Specification (Pass)',
          status: 'Within Limit',
        },
      ],
      microbiological: [
        {
          parameter: 'Aerobic Plate Count',
          method: 'Plate Count',
          limit: 'Acceptable Limit',
          observedResult: '<100 CFU/g',
          status: 'Conforms',
        },
        {
          parameter: 'Yeast & Mold Count',
          method: 'Plate Count',
          limit: 'Acceptable Limit',
          observedResult: '≤200 CFU/g (within acceptable limits)',
          status: 'Conforms',
        },
        {
          parameter: 'E. coli / Salmonella / Pseudomonas / Staphylococcus',
          method: 'Pathogen Screen',
          limit: 'Absent',
          observedResult: 'Absent',
          status: 'Absent',
        },
      ],
      updatedAt: now,
    },
  ];

  const cmsSections: CmsSection[] = [
    {
      id: 'cms-what-is',
      key: 'what_is_shilajit',
      title: 'What is Shilajit?',
      category: 'product',
      content:
        'Shilajit is a dark, tar-like mineral resin traditionally gathered from high-altitude Himalayan rock crevices, where plant matter and geological minerals undergo slow natural transformation over centuries. In classical Indian traditions, it is valued as a concentrated mineral-organic substance prepared for mindful daily use.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-ingredients',
      key: 'product_ingredients',
      title: 'Product Ingredients',
      category: 'product',
      content:
        '100% Shilajit Resin (Asphaltum punjabianum) presented in a 20 g semi-solid resin format with no added synthetic colors, artificial flavors, gums, or fillers.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-origin',
      key: 'origin_sourcing',
      title: 'Origin and Sourcing',
      category: 'product',
      content:
        'Sourced from Himalayan mineral-bearing regions and processed in small batches with water-based purification and controlled low-temperature concentration. Every jar carries a batch code linked to the Quality & Transparency registry.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-how-to-use',
      key: 'how_to_use',
      title: 'How to Use',
      category: 'product',
      content:
        'Take a small amount using a normal spoon and dissolve completely in lukewarm water, warm milk, or herbal tea. Stir until the liquid turns a rich amber-brown and consume once daily as part of your morning or evening routine.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-storage',
      key: 'storage_handling',
      title: 'Storage and Handling',
      category: 'product',
      content:
        'Always close the inner protective disc and outer gold cap tightly after use. Keep at room temperature in a cool, dry place away from direct sunlight. Natural resin stiffens slightly in winter and becomes more pliable in warmer weather; warming the closed jar briefly in your palms restores smooth scooping.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-precautions',
      key: 'precautions',
      title: 'Precautions',
      category: 'product',
      content:
        'Intended for adult use only. Not recommended for pregnant or nursing women, children, or individuals with elevated uric acid, gout, hemochromatosis, or known kidney conditions without medical guidance. This traditional wellness product is not intended to diagnose, treat, cure, or prevent any disease.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-batch-testing',
      key: 'batch_testing',
      title: 'Batch Testing',
      category: 'product',
      content:
        'Each production batch is logged in our Quality & Transparency center alongside heavy metal screening parameters, microbiological limits, and view-only laboratory reference records maintained by the store administrator.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-faq-1',
      key: 'faq_texture',
      title: 'Why does the resin texture change between summer and winter?',
      category: 'faq',
      content:
        'Genuine mineral resin responds naturally to ambient temperature—becoming firmer when cool and softer in warmer weather. Warming the closed jar briefly in your palms restores smooth scooping.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-faq-2',
      key: 'faq_solubility',
      title: 'Does HimRudra Shilajit dissolve completely in warm water?',
      category: 'faq',
      content:
        'Yes. A serving dissolves smoothly in lukewarm water, warm milk, or herbal tea into a rich amber-brown infusion without leaving gritty sand residue.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-faq-3',
      key: 'faq_duration',
      title: 'How long does one 20 g jar of HimRudra Shilajit last?',
      category: 'faq',
      content:
        'At the recommended serving of 500 mg daily, a single 20 g apothecary jar lasts approximately 40 days.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
    {
      id: 'cms-faq-4',
      key: 'faq_certificate',
      title: 'Is HimRudra Shilajit lab certified and can I download the report?',
      category: 'faq',
      content:
        'Yes. Every production batch is laboratory screened for Fulvic Acid assay, heavy metals, and microbiological safety. Click "Lab Certified" in the top navigation bar anytime to preview or download the official batch certificate.',
      approvedByAdmin: true,
      approvedAt: now,
      updatedAt: now,
    },
  ];

  const expenses: Expense[] = [];

  const inquiries: ContactInquiry[] = [];

  const adminNotifications: AdminNotification[] = [];

  return {
    users,
    products,
    settings,
    coupons,
    promotions,
    orders,
    labReports,
    cmsSections,
    expenses,
    inquiries,
    adminNotifications,
    paymentIntents: {},
  };
}

export interface StorageStatus {
  engine: 'cloud-sql-postgresql' | 'aws-dynamodb' | 'local-json';
  configured: boolean;
  authMode?: string;
  region?: string;
  tableName?: string;
  hydratedFromCloud: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

class StoreRepository {
  private state: DatabaseState;
  private postgres: PostgresStateAdapter | null = null;
  private postgresInitialized = false;
  private dynamo: DynamoStateAdapter | null = null;
  private dynamoInitialized = false;
  private lastPersistedFingerprints = new Map<string, string>();
  private hydratedFromCloud = false;
  private lastHydratedAtMs = 0;
  private hydrationPromise: Promise<Error | null> | null = null;
  private publicBootstrapCache: {
    data: Omit<PublicStoreBootstrap, 'serverNow'>;
    loadedAtMs: number;
    stateVersion: number;
  } | null = null;
  private publicBootstrapPromise: Promise<{
    data: Omit<PublicStoreBootstrap, 'serverNow'>;
    dbMs: number;
  }> | null = null;
  private hasServedPublicBootstrap = false;
  private syncChain: Promise<void> = Promise.resolve();
  private pendingSyncCount = 0;
  private lastCommitError: Error | null = null;
  private lastSyncedAt: string | null = null;
  private lastCloudError: string | null = null;
  private stateVersion = 1;

  constructor() {
    this.state = this.loadLocal();
  }

  private getPostgres(): PostgresStateAdapter | null {
    if (!this.postgresInitialized) {
      this.postgresInitialized = true;
      if (isCloudSqlConfigured()) {
        this.postgres = new PostgresStateAdapter();
      }
    }
    return this.postgres;
  }

  private getDynamo(): DynamoStateAdapter | null {
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

  getStateVersion(): number {
    return this.stateVersion;
  }

  private normalizeState(parsed: DatabaseState): boolean {
    let mutated = false;
    for (const p of parsed.products) {
      if (
        (p.id === 'himrudra-shilajit-20g' || p.id === 'himrudra-shilajit-40g-duo') &&
        (!p.customImages || p.customImages.length === 0)
      ) {
        p.customImages =
          p.id === 'himrudra-shilajit-40g-duo'
            ? [
                '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg',
                '/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg',
              ]
            : [
                '/assets/aistudio/WhatsApp_Image_2026-11-17_at_10.53.05_PM_b92dccc4.jpeg',
                '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.55.23_PM_2635dbf3.jpeg',
              ];
        mutated = true;
      }
    }
    // Legacy announcement text migration is handled below in settings normalization (avoid length-based ping-pong rewrites).
    for (const rep of parsed.labReports ?? []) {
      if (rep.id === 'lab-b04' && rep.heavyMetals?.[0]?.parameter !== 'Fulvic Acid (Active Component)') {
        rep.customDocumentUrl =
          '/assets/aistudio/WhatsApp_Image_2026-11-17_at_9.56.54_PM__1__2115dbef.jpeg';
        rep.laboratoryName = 'Eurofins Analytical Services (Reference Document Format)';
        rep.reportNumber = 'COA-1026134';
        rep.testedBatchNumber = '1026134';
        rep.testingMethodology =
          'Fulvic Acid Assay (77.15%), Heavy Metals & Microbiological Screening';
        rep.notes =
          'Reference Certificate of Analysis document attached for store review (Batch 1026134, Mfg. 10/2026, Exp. 09/2029). Kept unaltered as a reference format until the store owner uploads and marks an independently verifiable laboratory PDF as Verified.';
        rep.heavyMetals = [
          {
            parameter: 'Fulvic Acid (Active Component)',
            method: 'Eurofins Assay',
            specificationLimit: 'Reference Batch',
            observedResult: '77.15%',
            status: 'Within Limit',
          },
          {
            parameter: 'Lead (Pb)',
            method: 'Reference COA',
            specificationLimit: 'NMT Specification',
            observedResult: 'Meets Specification (Pass)',
            status: 'Within Limit',
          },
          {
            parameter: 'Arsenic (As)',
            method: 'Reference COA',
            specificationLimit: 'NMT Specification',
            observedResult: 'Meets Specification (Pass)',
            status: 'Within Limit',
          },
          {
            parameter: 'Mercury (Hg)',
            method: 'Reference COA',
            specificationLimit: 'NMT Specification',
            observedResult: 'Meets Specification (Pass)',
            status: 'Within Limit',
          },
          {
            parameter: 'Cadmium (Cd)',
            method: 'Reference COA',
            specificationLimit: 'NMT Specification',
            observedResult: 'Meets Specification (Pass)',
            status: 'Within Limit',
          },
        ];
        rep.microbiological = [
          {
            parameter: 'Aerobic Plate Count',
            method: 'Plate Count',
            limit: 'Acceptable Limit',
            observedResult: '<100 CFU/g',
            status: 'Conforms',
          },
          {
            parameter: 'Yeast & Mold Count',
            method: 'Plate Count',
            limit: 'Acceptable Limit',
            observedResult: '≤200 CFU/g (within acceptable limits)',
            status: 'Conforms',
          },
          {
            parameter: 'E. coli / Salmonella / Pseudomonas / Staphylococcus',
            method: 'Pathogen Screen',
            limit: 'Absent',
            observedResult: 'Absent',
            status: 'Absent',
          },
        ];
        mutated = true;
      }
    }
    const ownerEmail = getAdminOwnerEmail();
    const filteredUsers = (parsed.users ?? []).filter((u) => {
      const lower = u.email.toLowerCase();
      if (lower === 'admin@himrudra.in') return false;
      if (lower === 'atyansharma04488@gmail.com' && ownerEmail !== lower) return false;
      return true;
    });
    if (filteredUsers.length !== (parsed.users ?? []).length) {
      parsed.users = filteredUsers;
      mutated = true;
    }
    for (const u of parsed.users) {
      if (u.email.toLowerCase() !== ownerEmail && u.role === 'admin') {
        u.role = 'customer';
        mutated = true;
      }
    }
    const existingOwner = parsed.users.find((u) => u.email.toLowerCase() === ownerEmail);
    if (!existingOwner) {
      parsed.users.unshift({
        id: 'usr-owner-1',
        name: 'Rahul Mewara (Store Owner)',
        email: ownerEmail,
        phone: '9549572457',
        role: 'admin',
        passwordHash: hashPassword(getInitialAdminPassword()),
        createdAt: '2026-08-01T08:00:00.000Z',
        wishlistProductIds: [],
      });
      mutated = true;
    } else if (existingOwner.role !== 'admin') {
      existingOwner.role = 'admin';
      mutated = true;
    }
    if (!Array.isArray(parsed.promotions) || parsed.promotions.length === 0) {
      parsed.promotions = [
        {
          id: 'promo-freeship-nov26',
          title: 'Limited-Time Free Shipping Offer',
          description:
            'Free standard pan-India shipping on all orders placed before 1 December 2026.',
          bannerHeadline:
            'LIMITED-TIME OFFER — FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!',
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
        },
      ];
      mutated = true;
    }
    if (!Array.isArray(parsed.adminNotifications)) {
      parsed.adminNotifications = [];
      mutated = true;
    }
    if (!parsed.paymentIntents || typeof parsed.paymentIntents !== 'object') {
      parsed.paymentIntents = {};
      mutated = true;
    }
    if (parsed.settings) {
      const s = parsed.settings;
      if (typeof s.gatewayFeePercent !== 'number') {
        s.gatewayFeePercent = 2;
        mutated = true;
      }
      if (typeof s.defaultShippingCostPerOrder !== 'number') {
        s.defaultShippingCostPerOrder = 65;
        mutated = true;
      }
      if (!s.brandEmail) {
        s.brandEmail = 'himrudraofficial@gmail.com';
        s.orderNotificationEmail = 'himrudraofficial@gmail.com';
        s.emailNotificationsEnabled = true;
        mutated = true;
      }
      if (!s.brandPhone) {
        s.brandPhone = '9549572457';
        mutated = true;
      }
      if (!s.brandAddress) {
        s.brandAddress =
          'Marketed by- KP Enterprise, Office No 4-D fourth, Vardan Exclusive, Tower, Lakhudi Rd, near SARDAR PATEL STADIUM, Navrangpura, Ahmedabad, Gujarat 380009';
        mutated = true;
      }
      if (
        s.announcementText ===
        'Batch HR-SHJ-2026-B04 Now Shipping · Free Delivery ₹1,499+'
      ) {
        s.announcementText =
          'LIMITED-TIME OFFER — FREE SHIPPING ON ALL ORDERS UNTIL 30 NOVEMBER 2026!';
        mutated = true;
      }
    }
    for (const sec of parsed.cmsSections ?? []) {
      if (sec.id === 'cms-batch-testing' && sec.content.includes('downloadable')) {
        sec.content = sec.content.replace(
          'downloadable laboratory reference records',
          'view-only laboratory reference records'
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
      if (typeof ord.gatewayFeeAmount !== 'number') {
        ord.gatewayFeeAmount =
          ord.paymentMethod !== 'COD' && ord.paymentStatus === 'Paid'
            ? Math.round(ord.totalAmount * 0.02 * 100) / 100
            : 0;
        mutated = true;
      }
      if (typeof ord.actualShippingCost !== 'number') {
        ord.actualShippingCost =
          ord.status !== 'Cancelled' ? parsed.settings?.defaultShippingCostPerOrder ?? 65 : 0;
        mutated = true;
      }
    }
    return mutated;
  }

  private loadLocal(): DatabaseState {
    try {
      const sourceFile = fs.existsSync(DB_FILE)
        ? DB_FILE
        : fs.existsSync(BUNDLED_DB_FILE)
        ? BUNDLED_DB_FILE
        : null;

      if (sourceFile) {
        const raw = fs.readFileSync(sourceFile, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed && Array.isArray(parsed.products) && Array.isArray(parsed.users)) {
          const mutated = this.normalizeState(parsed);
          if (mutated) {
            this.saveLocal(parsed);
          }
          return parsed;
        }
      }
    } catch (err) {
      console.error('Failed to load store file, initializing seed state:', err);
    }
    const seed = createSeedState();
    this.saveLocal(seed);
    return seed;
  }

  private saveLocal(nextState: DatabaseState) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(nextState, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DB_FILE);
    } catch (err) {
      if (!IS_SERVERLESS) {
        throw err;
      }
      console.warn('Skipping non-fatal disk persistence in serverless runtime:', err);
    }
  }

  isPostgresEnabled(): boolean {
    return this.getPostgres() !== null;
  }

  isDynamoEnabled(): boolean {
    return this.getDynamo() !== null;
  }

  getStorageStatus(): StorageStatus {
    const pg = this.getPostgres();
    if (pg) {
      return {
        engine: 'cloud-sql-postgresql',
        configured: true,
        hydratedFromCloud: this.hydratedFromCloud,
        lastSyncedAt: this.lastSyncedAt,
        lastError: this.lastCloudError,
      };
    }

    const adapter = this.getDynamo();
    if (!adapter) {
      return {
        engine: 'local-json',
        configured: false,
        hydratedFromCloud: false,
        lastSyncedAt: this.lastSyncedAt,
        lastError: null,
      };
    }
    return {
      engine: 'aws-dynamodb',
      configured: true,
      authMode: adapter.config.authMode,
      region: adapter.config.region,
      tableName: adapter.config.tableName,
      hydratedFromCloud: this.hydratedFromCloud,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastCloudError,
    };
  }

  async ensureLoaded(options?: { forceRefresh?: boolean }): Promise<void> {
    const pg = this.getPostgres();
    const adapter = pg ? null : this.getDynamo();
    if (!pg && !adapter) return;

    // Wait for any in-flight writes before refreshing from cloud DB
    if (this.pendingSyncCount > 0) {
      await this.flushPendingSync().catch(() => {});
    }

    const nowMs = Date.now();
    // 60s cache on serverless (30s local) avoids re-hydrating all 12 tables on bursty reads;
    // mutations forceRefresh and immediately bump stateVersion.
    const cacheTtlMs = IS_SERVERLESS ? 60_000 : 30_000;
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

    this.hydrationPromise = (async (): Promise<Error | null> => {
      try {
        if (pg) {
          const loaded = await pg.loadState(() => createSeedState());
          if (loaded.empty) {
            // First-time Cloud SQL / Neon PostgreSQL bootstrap: seed empty tables with current store state
            await pg.persistState(this.state);
            this.hydratedFromCloud = true;
            this.lastHydratedAtMs = Date.now();
            this.lastSyncedAt = new Date().toISOString();
            this.lastCloudError = null;
            this.stateVersion += 1;
            this.publicBootstrapCache = null;
            return null;
          }

          const mutated = this.normalizeState(loaded.state);
          this.state = loaded.state;
          this.hydratedFromCloud = true;
          this.lastHydratedAtMs = Date.now();
          this.lastSyncedAt = new Date().toISOString();
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
            // First-time DynamoDB bootstrap: seed the empty table with initial store data
            const initialItems = serializeStateToDynamoItems(this.state);
            await adapter.applyDiff(initialItems, []);
            this.lastPersistedFingerprints = new Map(
              initialItems.map((item) => [item.pk, buildItemFingerprint(item)])
            );
            this.hydratedFromCloud = true;
            this.lastHydratedAtMs = Date.now();
            this.lastSyncedAt = new Date().toISOString();
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
            this.lastSyncedAt = new Date().toISOString();
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

  getState(): DatabaseState {
    return this.state;
  }

  private buildPublicBootstrapFromState(
    source: {
      products: Product[];
      settings: StoreSettings;
      coupons: Coupon[];
      promotions: Promotion[];
      labReports: LabReport[];
      cmsSections: CmsSection[];
    },
    nowMs: number
  ): PublicStoreBootstrap {
    return {
      products: source.products.filter((p) => p.active),
      settings: source.settings,
      coupons: source.coupons.filter((c) => c.active),
      promotions: getActivePromotions(source.promotions, nowMs),
      labReports: source.labReports,
      cmsSections: source.cmsSections.filter((s) => s.approvedByAdmin),
      serverNow: new Date(nowMs).toISOString(),
    };
  }

  /**
   * Fast-path public catalog bootstrap for GET /api/store/bootstrap.
   * On Postgres (Neon / Cloud SQL), runs ONE single SQL round-trip touching ONLY the
   * 6 public tables instead of full 12-table hydration, with in-memory TTL caching and
   * concurrent request coalescing.
   */
  async getPublicBootstrap(): Promise<{
    payload: PublicStoreBootstrap;
    cacheHit: boolean;
    coldStart: boolean;
    dbMs: number;
  }> {
    const coldStart = !this.hasServedPublicBootstrap;
    this.hasServedPublicBootstrap = true;

    const nowMs = Date.now();
    const cacheTtlMs = IS_SERVERLESS ? 60_000 : 30_000;

    // 1. Serve immediately from in-memory public cache if fresh & stateVersion unchanged
    if (
      this.publicBootstrapCache &&
      this.publicBootstrapCache.stateVersion === this.stateVersion &&
      nowMs - this.publicBootstrapCache.loadedAtMs < cacheTtlMs
    ) {
      return {
        payload: {
          ...this.publicBootstrapCache.data,
          promotions: getActivePromotions(this.publicBootstrapCache.data.promotions, nowMs),
          serverNow: new Date(nowMs).toISOString(),
        },
        cacheHit: true,
        coldStart,
        dbMs: 0,
      };
    }

    // 2. If full state was already freshly hydrated (or we are in local-json mode), build from memory
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
          cmsSections: payload.cmsSections,
        },
        loadedAtMs: nowMs,
        stateVersion: this.stateVersion,
      };
      return { payload, cacheHit: false, coldStart, dbMs: 0 };
    }

    if (
      this.hydratedFromCloud &&
      nowMs - this.lastHydratedAtMs < cacheTtlMs &&
      this.pendingSyncCount === 0
    ) {
      const payload = this.buildPublicBootstrapFromState(this.state, nowMs);
      this.publicBootstrapCache = {
        data: {
          products: payload.products,
          settings: payload.settings,
          coupons: payload.coupons,
          promotions: this.state.promotions,
          labReports: payload.labReports,
          cmsSections: payload.cmsSections,
        },
        loadedAtMs: nowMs,
        stateVersion: this.stateVersion,
      };
      return { payload, cacheHit: true, coldStart, dbMs: 0 };
    }

    // 3. Coalesce concurrent cold-start bootstrap requests into ONE single SQL query
    if (!this.publicBootstrapPromise) {
      this.publicBootstrapPromise = (async () => {
        const res = await pg.loadPublicBootstrap();
        if (res.empty) {
          // Brand-new database: run full ensureLoaded() once to seed initial store catalog
          await this.ensureLoaded();
          const seeded: Omit<PublicStoreBootstrap, 'serverNow'> = {
            products: this.state.products.filter((p) => p.active),
            settings: this.state.settings,
            coupons: this.state.coupons.filter((c) => c.active),
            promotions: this.state.promotions,
            labReports: this.state.labReports,
            cmsSections: this.state.cmsSections.filter((s) => s.approvedByAdmin),
          };
          return { data: seeded, dbMs: res.dbMs };
        }

        const effectiveSettings = res.data.settings ?? this.state.settings;
        const effectivePromotions =
          res.data.promotions.length > 0 ? res.data.promotions : this.state.promotions;

        const data: Omit<PublicStoreBootstrap, 'serverNow'> = {
          products: res.data.products,
          settings: effectiveSettings,
          coupons: res.data.coupons,
          promotions: effectivePromotions,
          labReports: res.data.labReports,
          cmsSections: res.data.cmsSections,
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
        stateVersion: this.stateVersion,
      };
      this.lastSyncedAt = new Date(doneMs).toISOString();
      this.lastCloudError = null;
      return {
        payload: {
          ...data,
          promotions: getActivePromotions(data.promotions, doneMs),
          serverNow: new Date(doneMs).toISOString(),
        },
        cacheHit: false,
        coldStart,
        dbMs,
      };
    } catch (err) {
      this.lastCloudError = err instanceof Error ? err.message : String(err);
      // Graceful fallback to last cached / bundled catalog if transient DB outage occurs
      const fallback = this.buildPublicBootstrapFromState(this.state, Date.now());
      return {
        payload: fallback,
        cacheHit: false,
        coldStart,
        dbMs: Date.now() - nowMs,
      };
    }
  }

  private mergeUserIntoMemory(saved: StoredUser): StoredUser {
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

  async findUserByEmail(email: string): Promise<StoredUser | null> {
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

  async findUserById(id: string): Promise<StoredUser | null> {
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

  async upsertUser(user: StoredUser, uid?: string): Promise<StoredUser> {
    const pg = this.getPostgres();
    if (pg) {
      const saved = await pg.upsertUser(user, uid);
      this.mergeUserIntoMemory(saved);
      this.stateVersion += 1;
      this.lastSyncedAt = new Date().toISOString();
      this.lastCloudError = null;
      this.saveLocal(this.state);
      return saved;
    }

    this.mergeUserIntoMemory(user);
    this.commit();
    return user;
  }

  async createUserIfNotExists(user: StoredUser): Promise<StoredUser | null> {
    const normalizedEmail = user.email.trim().toLowerCase();
    const pg = this.getPostgres();
    if (pg) {
      const created = await pg.createUserIfNotExists({ ...user, email: normalizedEmail });
      if (!created) return null;
      this.mergeUserIntoMemory(created);
      this.stateVersion += 1;
      this.lastSyncedAt = new Date().toISOString();
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

  /**
   * Atomically persists a newly placed Order + inventory stock decrement using a PostgreSQL ACID transaction
   * (or DynamoDB TransactWrite when DynamoDB is configured).
   * Ensures 500 concurrent buyers cannot oversell stock or create duplicate orders.
   */
  async upsertPaymentIntent(intent: PaymentIntentRecord): Promise<void> {
    const pg = this.getPostgres();
    if (pg) {
      await pg.upsertPaymentIntent(intent);
      this.state.paymentIntents[intent.razorpayOrderId] = intent;
      this.lastSyncedAt = new Date().toISOString();
      this.lastCloudError = null;
      return;
    }

    this.state.paymentIntents[intent.razorpayOrderId] = intent;
    this.commit();
  }

  async findPaymentIntent(razorpayOrderId: string): Promise<PaymentIntentRecord | null> {
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

  async loadCheckoutContext(params?: {
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    includeOrderSequence?: boolean;
  }): Promise<Omit<PostgresCheckoutContext, 'empty' | 'settings'> & { settings: StoreSettings }> {
    const pg = this.getPostgres();
    if (pg) {
      const loaded = await pg.loadCheckoutContext(params);
      if (!loaded.empty) {
        const effectiveSettings = loaded.settings ?? this.state.settings;
        // Keep in-memory catalog mirrors fresh for public bootstrap without marking full 12-table hydration complete
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
          maxOrderSeq: loaded.maxOrderSeq,
        };
      }
      // Brand-new empty Postgres DB: perform initial one-time seed hydration
      await this.ensureLoaded({ forceRefresh: true });
    }

    const existingOrderByPayment =
      params?.razorpayPaymentId || params?.razorpayOrderId
        ? this.state.orders.find(
            (o) =>
              (params.razorpayPaymentId && o.razorpayPaymentId === params.razorpayPaymentId) ||
              (params.razorpayOrderId && o.razorpayOrderId === params.razorpayOrderId)
          ) ?? null
        : null;

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
      paymentIntent: params?.razorpayOrderId
        ? this.state.paymentIntents[params.razorpayOrderId] ?? null
        : null,
      existingOrderByPayment,
      maxOrderSeq,
    };
  }

  async commitOrderAtomic(
    order: Order,
    stockDecrements: Array<{ productId: string; quantity: number }>,
    extras?: {
      promotionUpdate?: { promotionId: string; revenueDelta: number };
      adminNotification?: AdminNotification;
      userDefaultAddressUpdate?: { userId: string; address: ShippingAddress };
    }
  ): Promise<{ existingOrder?: Order; updatedProducts?: Array<{ id: string; stock: number }> }> {
    const pg = this.getPostgres();
    if (pg) {
      const txResult = await pg.transactCreateOrderAndDecrementStock({
        order,
        stockDecrements,
        promotionUpdate: extras?.promotionUpdate,
        adminNotification: extras?.adminNotification,
        userDefaultAddressUpdate: extras?.userDefaultAddressUpdate,
      });

      if (txResult.existingOrder) {
        return { existingOrder: txResult.existingOrder };
      }

      // Sync authoritative decremented stock & order metadata into memory without running a full 12-table persistState()
      for (const upd of txResult.updatedProducts) {
        const prod = this.state.products.find((p) => p.id === upd.id);
        if (prod) {
          prod.stock = upd.stock;
        }
      }
      if (!this.state.orders.some((o) => o.id === order.id)) {
        this.state.orders.unshift(order);
      }
      if (
        extras?.adminNotification &&
        !this.state.adminNotifications.some((n) => n.id === extras.adminNotification!.id)
      ) {
        this.state.adminNotifications.unshift(extras.adminNotification);
      }
      if (extras?.userDefaultAddressUpdate) {
        const u = this.state.users.find((usr) => usr.id === extras.userDefaultAddressUpdate!.userId);
        if (u && !u.defaultAddress) {
          u.defaultAddress = extras.userDefaultAddressUpdate.address;
        }
      }

      this.stateVersion += 1;
      this.lastSyncedAt = new Date().toISOString();
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
      entityType: 'order' as const,
      sortOrder: 0,
      payload: JSON.parse(JSON.stringify(order)),
      updatedAt: new Date().toISOString(),
    };

    await adapter.transactCreateOrderAndDecrementStock({
      orderItem,
      stockDecrements,
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
      const snapshot: DatabaseState = JSON.parse(JSON.stringify(this.state));
      this.pendingSyncCount += 1;

      this.syncChain = this.syncChain
        .then(async () => {
          await pg.persistState(snapshot);
          this.lastHydratedAtMs = Date.now();
          this.lastSyncedAt = new Date().toISOString();
          this.lastCloudError = null;
          this.lastCommitError = null;
        })
        .catch((err) => {
          const errorObj = err instanceof Error ? err : new Error(String(err));
          this.lastCloudError = errorObj.message;
          this.lastCommitError = errorObj;
          this.hydratedFromCloud = false;
        })
        .finally(() => {
          this.pendingSyncCount = Math.max(0, this.pendingSyncCount - 1);
        });
      return;
    }

    const adapter = this.getDynamo();
    if (!adapter) {
      this.lastSyncedAt = new Date().toISOString();
      return;
    }

    const nextItems = serializeStateToDynamoItems(this.state);
    this.pendingSyncCount += 1;

    this.syncChain = this.syncChain
      .then(async () => {
        const diff = computeDynamoDiff(this.lastPersistedFingerprints, nextItems);
        await adapter.applyDiff(diff.toPut, diff.toDeletePks);
        this.lastPersistedFingerprints = diff.nextFingerprints;
        this.lastHydratedAtMs = Date.now();
        this.lastSyncedAt = new Date().toISOString();
        this.lastCloudError = null;
        this.lastCommitError = null;
      })
      .catch((err) => {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        this.lastCloudError = errorObj.message;
        this.lastCommitError = errorObj;
        this.hydratedFromCloud = false;
      })
      .finally(() => {
        this.pendingSyncCount = Math.max(0, this.pendingSyncCount - 1);
      });
  }

  hasPendingSync(): boolean {
    return this.pendingSyncCount > 0;
  }

  async flushPendingSync(): Promise<void> {
    await this.syncChain;
    if (this.lastCommitError) {
      const err = this.lastCommitError;
      this.lastCommitError = null;
      throw err;
    }
  }

  sanitizeUser(u: StoredUser): User {
    const { passwordHash: _ignored, ...safe } = u;
    return {
      ...safe,
      role:
        safe.role === 'admin' && safe.email.toLowerCase() === getAdminOwnerEmail()
          ? 'admin'
          : 'customer',
    };
  }
}

export const storeRepo = new StoreRepository();
