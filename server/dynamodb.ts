import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  getAwsDynamoConfig,
  resolveAwsAuthMode,
  type AwsDynamoConfig,
} from './awsConfig.ts';
import { logStructured } from './logger.ts';
import { assertDynamoItemsValid, StorePersistenceError } from './validation.ts';
import type { DatabaseState, StoredUser } from './store.ts';
import type {
  ContactInquiry,
  LabReport,
  Order,
  Product,
} from '../src/types.ts';

export type DynamoEntityType =
  | 'settings'
  | 'coupons'
  | 'promotions'
  | 'cmsSections'
  | 'expenses'
  | 'adminNotifications'
  | 'paymentIntents'
  | 'user'
  | 'product'
  | 'order'
  | 'labReport'
  | 'inquiry';

export interface DynamoStoreItem {
  pk: string;
  entityType: DynamoEntityType;
  sortOrder?: number;
  payload: unknown;
  updatedAt: string;
}

export type DynamoConfig = AwsDynamoConfig;

export function getDynamoConfig(
  env: Record<string, string | undefined> = process.env
): DynamoConfig {
  return getAwsDynamoConfig(env);
}

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function serializeStateToDynamoItems(
  state: DatabaseState,
  updatedAt = new Date().toISOString()
): DynamoStoreItem[] {
  const items: DynamoStoreItem[] = [
    {
      pk: 'META#settings',
      entityType: 'settings',
      payload: stripUndefined(state.settings),
      updatedAt,
    },
    {
      pk: 'META#coupons',
      entityType: 'coupons',
      payload: stripUndefined(state.coupons),
      updatedAt,
    },
    {
      pk: 'META#promotions',
      entityType: 'promotions',
      payload: stripUndefined(state.promotions),
      updatedAt,
    },
    {
      pk: 'META#cmsSections',
      entityType: 'cmsSections',
      payload: stripUndefined(state.cmsSections),
      updatedAt,
    },
    {
      pk: 'META#expenses',
      entityType: 'expenses',
      payload: stripUndefined(state.expenses),
      updatedAt,
    },
    {
      pk: 'META#adminNotifications',
      entityType: 'adminNotifications',
      payload: stripUndefined(state.adminNotifications),
      updatedAt,
    },
    {
      pk: 'META#paymentIntents',
      entityType: 'paymentIntents',
      payload: stripUndefined(state.paymentIntents),
      updatedAt,
    },
  ];

  state.users.forEach((user, idx) => {
    items.push({
      pk: `USER#${user.id}`,
      entityType: 'user',
      sortOrder: idx,
      payload: stripUndefined(user),
      updatedAt,
    });
  });

  state.products.forEach((product, idx) => {
    items.push({
      pk: `PRODUCT#${product.id}`,
      entityType: 'product',
      sortOrder: idx,
      payload: stripUndefined(product),
      updatedAt,
    });
  });

  state.orders.forEach((order, idx) => {
    items.push({
      pk: `ORDER#${order.id}`,
      entityType: 'order',
      sortOrder: idx,
      payload: stripUndefined(order),
      updatedAt,
    });
  });

  state.labReports.forEach((report, idx) => {
    items.push({
      pk: `LABREPORT#${report.id}`,
      entityType: 'labReport',
      sortOrder: idx,
      payload: stripUndefined(report),
      updatedAt,
    });
  });

  state.inquiries.forEach((inquiry, idx) => {
    items.push({
      pk: `INQUIRY#${inquiry.id}`,
      entityType: 'inquiry',
      sortOrder: idx,
      payload: stripUndefined(inquiry),
      updatedAt,
    });
  });

  return items;
}

export function deserializeDynamoItemsToState(
  items: DynamoStoreItem[],
  fallbackSeed: DatabaseState
): DatabaseState | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const byPk = new Map<string, DynamoStoreItem>();
  for (const item of items) {
    if (item && typeof item.pk === 'string') {
      byPk.set(item.pk, item);
    }
  }

  const sortByOrder = (a: DynamoStoreItem, b: DynamoStoreItem) =>
    (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER);

  const users = items
    .filter((i) => i.entityType === 'user' || i.pk.startsWith('USER#'))
    .sort(sortByOrder)
    .map((i) => i.payload as StoredUser);

  const products = items
    .filter((i) => i.entityType === 'product' || i.pk.startsWith('PRODUCT#'))
    .sort(sortByOrder)
    .map((i) => i.payload as Product);

  const orders = items
    .filter((i) => i.entityType === 'order' || i.pk.startsWith('ORDER#'))
    .sort(sortByOrder)
    .map((i) => i.payload as Order);

  const labReports = items
    .filter((i) => i.entityType === 'labReport' || i.pk.startsWith('LABREPORT#'))
    .sort(sortByOrder)
    .map((i) => i.payload as LabReport);

  const inquiries = items
    .filter((i) => i.entityType === 'inquiry' || i.pk.startsWith('INQUIRY#'))
    .sort(sortByOrder)
    .map((i) => i.payload as ContactInquiry);

  const getMeta = <T>(pk: string, fallback: T): T => {
    const found = byPk.get(pk);
    return found && found.payload !== undefined ? (found.payload as T) : fallback;
  };

  return {
    users: users.length > 0 ? users : fallbackSeed.users,
    products: products.length > 0 ? products : fallbackSeed.products,
    settings: getMeta('META#settings', fallbackSeed.settings),
    coupons: getMeta('META#coupons', fallbackSeed.coupons),
    promotions: getMeta('META#promotions', fallbackSeed.promotions),
    orders,
    labReports: labReports.length > 0 ? labReports : fallbackSeed.labReports,
    cmsSections: getMeta('META#cmsSections', fallbackSeed.cmsSections),
    expenses: getMeta('META#expenses', fallbackSeed.expenses),
    inquiries,
    adminNotifications: getMeta('META#adminNotifications', fallbackSeed.adminNotifications),
    paymentIntents: getMeta('META#paymentIntents', fallbackSeed.paymentIntents),
  };
}

export function buildItemFingerprint(item: DynamoStoreItem): string {
  return JSON.stringify({
    entityType: item.entityType,
    sortOrder: item.sortOrder,
    payload: item.payload,
  });
}

export function computeDynamoDiff(
  previousFingerprints: Map<string, string>,
  nextItems: DynamoStoreItem[]
): {
  toPut: DynamoStoreItem[];
  toDeletePks: string[];
  nextFingerprints: Map<string, string>;
} {
  const nextFingerprints = new Map<string, string>();
  const toPut: DynamoStoreItem[] = [];

  for (const item of nextItems) {
    const fp = buildItemFingerprint(item);
    nextFingerprints.set(item.pk, fp);
    if (previousFingerprints.get(item.pk) !== fp) {
      toPut.push(item);
    }
  }

  const toDeletePks: string[] = [];
  for (const prevPk of previousFingerprints.keys()) {
    if (!nextFingerprints.has(prevPk)) {
      toDeletePks.push(prevPk);
    }
  }

  return { toPut, toDeletePks, nextFingerprints };
}

export class DynamoStateAdapter {
  readonly config: DynamoConfig;
  private docClient: DynamoDBDocumentClient;

  constructor(config: DynamoConfig) {
    this.config = config;
    const { credentials } = resolveAwsAuthMode(process.env, config.endpoint);

    const client = new DynamoDBClient({
      region: config.region,
      maxAttempts: 4,
      retryMode: 'adaptive',
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(credentials ? { credentials } : {}),
    });

    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
      },
    });
  }

  async loadAllItems(): Promise<DynamoStoreItem[]> {
    const startedAt = Date.now();
    const items: DynamoStoreItem[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    try {
      do {
        const response = await this.docClient.send(
          new ScanCommand({
            TableName: this.config.tableName,
            ExclusiveStartKey: exclusiveStartKey,
          })
        );
        if (Array.isArray(response.Items)) {
          for (const raw of response.Items) {
            items.push(raw as DynamoStoreItem);
          }
        }
        exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);

      logStructured('info', 'aws-dynamodb', 'scan_complete', {
        table: this.config.tableName,
        itemCount: items.length,
        durationMs: Date.now() - startedAt,
      });

      return items;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'DynamoDB scan failed';
      logStructured('error', 'aws-dynamodb', 'scan_failed', {
        table: this.config.tableName,
        durationMs: Date.now() - startedAt,
        error: msg,
      });
      throw new StorePersistenceError(`AWS DynamoDB read failed: ${msg}`, {
        code: 'DYNAMO_READ_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async applyDiff(toPut: DynamoStoreItem[], toDeletePks: string[]): Promise<void> {
    if (toPut.length === 0 && toDeletePks.length === 0) return;

    // Validate schema and 380 KB item-size limit BEFORE sending to DynamoDB
    assertDynamoItemsValid(toPut);

    const startedAt = Date.now();
    type WriteReq =
      | { PutRequest: { Item: DynamoStoreItem } }
      | { DeleteRequest: { Key: { pk: string } } };

    const requests: WriteReq[] = [
      ...toPut.map((item) => ({ PutRequest: { Item: item } })),
      ...toDeletePks.map((pk) => ({ DeleteRequest: { Key: { pk } } })),
    ];

    try {
      for (let i = 0; i < requests.length; i += 25) {
        let batch: WriteReq[] = requests.slice(i, i + 25);
        let attempt = 0;

        while (batch.length > 0 && attempt < 5) {
          const res = await this.docClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [this.config.tableName]: batch,
              },
            })
          );

          const unprocessed = res.UnprocessedItems?.[this.config.tableName] as
            | WriteReq[]
            | undefined;
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
            { code: 'DYNAMO_THROTTLED', statusCode: 503, retryable: true }
          );
        }
      }

      logStructured('info', 'aws-dynamodb', 'batch_write_complete', {
        table: this.config.tableName,
        puts: toPut.length,
        deletes: toDeletePks.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      if (err instanceof StorePersistenceError) throw err;
      const msg = err instanceof Error ? err.message : 'DynamoDB write failed';
      logStructured('error', 'aws-dynamodb', 'batch_write_failed', {
        table: this.config.tableName,
        puts: toPut.length,
        deletes: toDeletePks.length,
        durationMs: Date.now() - startedAt,
        error: msg,
      });
      throw new StorePersistenceError(`AWS DynamoDB write failed: ${msg}`, {
        code: 'DYNAMO_WRITE_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  /**
   * Atomically creates a new Order item and conditionally decrements each Product's stock
   * in a single DynamoDB transaction so 500 concurrent checkouts can never oversell inventory.
   */
  async transactCreateOrderAndDecrementStock(params: {
    orderItem: DynamoStoreItem;
    stockDecrements: Array<{ productId: string; quantity: number }>;
  }): Promise<void> {
    assertDynamoItemsValid([params.orderItem]);

    const nowIso = new Date().toISOString();
    const startedAt = Date.now();

    const transactItems: Array<Record<string, unknown>> = [
      {
        Put: {
          TableName: this.config.tableName,
          Item: params.orderItem,
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      },
      ...params.stockDecrements.map((dec) => ({
        Update: {
          TableName: this.config.tableName,
          Key: { pk: `PRODUCT#${dec.productId}` },
          UpdateExpression: 'SET payload.stock = payload.stock - :qty, updatedAt = :now',
          ConditionExpression: 'attribute_exists(pk) AND payload.stock >= :qty',
          ExpressionAttributeValues: {
            ':qty': dec.quantity,
            ':now': nowIso,
          },
        },
      })),
    ];

    try {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems,
        })
      );

      logStructured('info', 'aws-dynamodb', 'order_transaction_committed', {
        table: this.config.tableName,
        orderPk: params.orderItem.pk,
        itemsCount: params.stockDecrements.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      const errName =
        typeof err === 'object' && err !== null && 'name' in err
          ? String((err as { name?: unknown }).name)
          : '';
      const msg = err instanceof Error ? err.message : 'Transaction failed';

      logStructured('error', 'aws-dynamodb', 'order_transaction_failed', {
        table: this.config.tableName,
        orderPk: params.orderItem.pk,
        errorName: errName,
        durationMs: Date.now() - startedAt,
        error: msg,
      });

      if (errName === 'TransactionCanceledException') {
        throw new StorePersistenceError(
          'Stock changed while placing your order or this order was already submitted. Please refresh your cart and try again.',
          { code: 'ORDER_CONFLICT_OR_OUT_OF_STOCK', statusCode: 409, retryable: false }
        );
      }

      throw new StorePersistenceError(`Could not save order to AWS DynamoDB: ${msg}`, {
        code: 'DYNAMO_TRANSACTION_FAILED',
        statusCode: 503,
        retryable: true,
      });
    }
  }
}
