import "dotenv/config";
import mongoose, { Types } from "mongoose";

/**
 * One-time data migration following the fix to every schema's `@Prop({ type: Types.ObjectId, ... })`
 * declarations (the bug: @nestjs/mongoose only recognizes `Schema.Types.ObjectId`, so it silently
 * treated `Types.ObjectId` as an unrelated nested-class reference and fell back to `Mixed` - a type
 * that performs no casting at all). Under that bug, any code path that assigned a plain string
 * (a JWT `sub`, a request-body id, a route param) to one of these fields persisted it as a raw
 * string instead of a real ObjectId. The schema fix alone does not correct documents already
 * written that way - existing string values are simply not valid ObjectIds to matching queries
 * that assume the schema's declared type, and reference-based reads (aggregation $match, $lookup)
 * against them silently return nothing. This walks every affected collection/field and converts
 * any string that looks like a valid ObjectId into a real one, leaving already-correct values and
 * anything else untouched. Safe to re-run - already-converted fields are simply skipped.
 *
 * Usage: npm run migrate-objectid-refs
 */

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

function toObjectId(value: unknown): Types.ObjectId | undefined {
  if (typeof value !== "string" || !OBJECT_ID_RE.test(value)) return undefined;
  return new Types.ObjectId(value);
}

interface MigrationStats {
  collection: string;
  scanned: number;
  updated: number;
}

/** Converts a single top-level (optionally dot-path nested) string field to ObjectId. */
async function migrateField(
  db: mongoose.mongo.Db,
  collectionName: string,
  fieldPath: string,
): Promise<MigrationStats> {
  const collection = db.collection(collectionName);
  const cursor = collection.find({ [fieldPath]: { $type: "string" } });

  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned++;
    const raw = fieldPath.split(".").reduce<any>((acc, key) => acc?.[key], doc);
    const converted = toObjectId(raw);
    if (!converted) continue;

    await collection.updateOne({ _id: doc._id }, { $set: { [fieldPath]: converted } });
    updated++;
  }

  return { collection: collectionName, scanned, updated };
}

/** Converts every element of a top-level array-of-ObjectId field (e.g. savedItems: string[]). */
async function migrateArrayField(
  db: mongoose.mongo.Db,
  collectionName: string,
  fieldPath: string,
): Promise<MigrationStats> {
  const collection = db.collection(collectionName);
  const cursor = collection.find({ [fieldPath]: { $elemMatch: { $type: "string" } } });

  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned++;
    const raw: unknown[] = doc[fieldPath] ?? [];
    const next = raw.map((v) => toObjectId(v) ?? v);
    await collection.updateOne({ _id: doc._id }, { $set: { [fieldPath]: next } });
    updated++;
  }

  return { collection: collectionName, scanned, updated };
}

/** Converts productId/flashSaleId inside each order's items[] subdocument array. */
async function migrateOrderItems(db: mongoose.mongo.Db): Promise<MigrationStats> {
  const collection = db.collection("orders");
  const cursor = collection.find({});

  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned++;
    const items: any[] = doc.items ?? [];
    let changed = false;

    const nextItems = items.map((item) => {
      const productId = toObjectId(item.productId);
      const flashSaleId = toObjectId(item.flashSaleId);
      if (!productId && !flashSaleId) return item;
      changed = true;
      return {
        ...item,
        ...(productId ? { productId } : {}),
        ...(flashSaleId ? { flashSaleId } : {}),
      };
    });

    if (!changed) continue;
    await collection.updateOne({ _id: doc._id }, { $set: { items: nextItems } });
    updated++;
  }

  return { collection: "orders (items[])", scanned, updated };
}

/** Converts userId inside each flash sale's bids[] subdocument array. */
async function migrateFlashSaleBids(db: mongoose.mongo.Db): Promise<MigrationStats> {
  const collection = db.collection("flashsales");
  const cursor = collection.find({});

  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned++;
    const bids: any[] = doc.bids ?? [];
    let changed = false;

    const nextBids = bids.map((bid) => {
      const userId = toObjectId(bid.userId);
      if (!userId) return bid;
      changed = true;
      return { ...bid, userId };
    });

    if (!changed) continue;
    await collection.updateOne({ _id: doc._id }, { $set: { bids: nextBids } });
    updated++;
  }

  return { collection: "flashsales (bids[])", scanned, updated };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  const results: MigrationStats[] = [];

  results.push(await migrateField(db, "orders", "customerId"));
  results.push(await migrateField(db, "orders", "vendorId"));
  results.push(await migrateField(db, "orders", "paymentId"));
  results.push(await migrateOrderItems(db));

  results.push(await migrateField(db, "payments", "orderId"));
  results.push(await migrateField(db, "payments", "customerId"));
  results.push(await migrateField(db, "payments", "vendorId"));
  results.push(await migrateField(db, "payments", "payoutId"));

  results.push(await migrateField(db, "payouts", "vendorId"));
  results.push(await migrateArrayField(db, "payouts", "paymentIds"));

  results.push(await migrateField(db, "reviews", "orderId"));
  results.push(await migrateField(db, "reviews", "productId"));
  results.push(await migrateField(db, "reviews", "vendorId"));
  results.push(await migrateField(db, "reviews", "customerId"));

  results.push(await migrateField(db, "notifications", "userId"));

  results.push(await migrateField(db, "messages", "conversationId"));
  results.push(await migrateField(db, "messages", "senderId"));

  results.push(await migrateField(db, "conversations", "participants.customerId"));
  results.push(await migrateField(db, "conversations", "participants.vendorId"));
  results.push(await migrateField(db, "conversations", "orderId"));
  results.push(await migrateField(db, "conversations", "lastMessage.senderId"));

  results.push(await migrateField(db, "flashsales", "vendorId"));
  results.push(await migrateField(db, "flashsales", "productId"));
  results.push(await migrateField(db, "flashsales", "currentBidder"));
  results.push(await migrateField(db, "flashsales", "winner"));
  results.push(await migrateFlashSaleBids(db));

  results.push(await migrateField(db, "products", "vendorId"));
  results.push(await migrateField(db, "products", "flashSaleId"));

  results.push(await migrateArrayField(db, "users", "savedItems"));

  console.log("\nMigration complete:");
  for (const r of results) {
    if (r.scanned > 0) console.log(`  ${r.collection}: ${r.updated}/${r.scanned} converted`);
  }
  const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
  console.log(`\nTotal documents updated: ${totalUpdated}`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
