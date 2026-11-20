import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  DynamoStateAdapter,
  deserializeDynamoItemsToState,
  getDynamoConfig,
  serializeStateToDynamoItems,
} from '../server/dynamodb.ts';
import {
  MAX_DYNAMO_ITEM_BYTES,
  assertDynamoItemsValid,
  estimateDynamoItemBytes,
} from '../server/validation.ts';
import type { DatabaseState } from '../server/store.ts';

dotenv.config();

const DB_FILE = path.resolve(process.cwd(), 'data', 'himrudra-db.json');
const BACKUP_DIR = path.resolve(process.cwd(), 'data', 'backups');

function printUsage() {
  console.log(`
HimRudra AWS DynamoDB Migration & Backup Utility
------------------------------------------------
Usage:
  npx tsx scripts/migrate-to-dynamodb.ts --dry-run
      Validate local data/himrudra-db.json against DynamoDB's 380 KB item ceiling
      and preview every entity key without writing to AWS.

  npx tsx scripts/migrate-to-dynamodb.ts --apply [--force]
      Migrate local data/himrudra-db.json into AWS DynamoDB.
      Refuses to overwrite a table that already contains orders unless --force is passed.

  npx tsx scripts/migrate-to-dynamodb.ts --backup
      Export all items from AWS DynamoDB into data/backups/himrudra-backup-<timestamp>.json.
`);
}

function loadLocalJson(): DatabaseState {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`Local database file not found at ${DB_FILE}`);
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw) as DatabaseState;
}

async function runDryRun() {
  const state = loadLocalJson();
  const items = serializeStateToDynamoItems(state);

  let maxBytes = 0;
  let largestPk = '';
  const counts = new Map<string, number>();

  for (const item of items) {
    const bytes = estimateDynamoItemBytes(item);
    if (bytes > maxBytes) {
      maxBytes = bytes;
      largestPk = item.pk;
    }
    counts.set(item.entityType, (counts.get(item.entityType) || 0) + 1);
  }

  assertDynamoItemsValid(items);

  console.log('\n[DRY-RUN PASSED] Local dataset is valid for AWS DynamoDB.');
  console.log(`  Source file : ${DB_FILE}`);
  console.log(`  Total items : ${items.length}`);
  console.log(
    `  Largest item: ${largestPk} (${(maxBytes / 1024).toFixed(2)} KB / ${Math.round(MAX_DYNAMO_ITEM_BYTES / 1024)} KB ceiling)`
  );
  console.log('  Entity breakdown:');
  for (const [type, count] of [...counts.entries()].sort()) {
    console.log(`    - ${type}: ${count}`);
  }

  const cfg = getDynamoConfig();
  console.log(
    `\n  Target AWS DynamoDB: ${
      cfg.enabled
        ? `${cfg.tableName} (${cfg.region}, auth=${cfg.authMode})`
        : 'Not configured yet (set AWS_DYNAMODB_TABLE + AWS credentials or AWS_ROLE_ARN)'
    }`
  );
}

async function runApply(force: boolean) {
  const cfg = getDynamoConfig();
  if (!cfg.enabled) {
    throw new Error(
      'AWS DynamoDB is not configured. Set AWS_DYNAMODB_TABLE, AWS_REGION, and AWS credentials (or AWS_ROLE_ARN).'
    );
  }

  const state = loadLocalJson();
  const items = serializeStateToDynamoItems(state);
  assertDynamoItemsValid(items);

  const adapter = new DynamoStateAdapter(cfg);
  const existingItems = await adapter.loadAllItems();
  const existingOrders = existingItems.filter((i) => i.entityType === 'order');

  if (existingOrders.length > 0 && !force) {
    throw new Error(
      `Refusing to overwrite ${existingOrders.length} existing order(s) in DynamoDB table "${cfg.tableName}". Run --backup first or pass --force if intentional.`
    );
  }

  console.log(`Migrating ${items.length} validated items to DynamoDB table "${cfg.tableName}" (${cfg.region})...`);
  await adapter.applyDiff(items, []);
  console.log(`[APPLY COMPLETE] Successfully wrote ${items.length} items to "${cfg.tableName}".`);
}

async function runBackup() {
  const cfg = getDynamoConfig();
  if (!cfg.enabled) {
    throw new Error(
      'AWS DynamoDB is not configured. Set AWS_DYNAMODB_TABLE, AWS_REGION, and AWS credentials (or AWS_ROLE_ARN).'
    );
  }

  const adapter = new DynamoStateAdapter(cfg);
  const items = await adapter.loadAllItems();
  const localFallback = fs.existsSync(DB_FILE) ? loadLocalJson() : null;

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(BACKUP_DIR, `himrudra-backup-${stamp}.json`);
  const reconstructed = localFallback
    ? deserializeDynamoItemsToState(items, localFallback)
    : null;

  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        tableName: cfg.tableName,
        region: cfg.region,
        itemCount: items.length,
        state: reconstructed,
        rawItems: items,
      },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`[BACKUP COMPLETE] Exported ${items.length} DynamoDB items to ${outFile}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--dry-run')) {
    await runDryRun();
    return;
  }
  if (args.has('--apply')) {
    await runApply(args.has('--force'));
    return;
  }
  if (args.has('--backup')) {
    await runBackup();
    return;
  }
  printUsage();
}

main().catch((err) => {
  console.error('[MIGRATION ERROR]', err instanceof Error ? err.message : err);
  process.exit(1);
});
