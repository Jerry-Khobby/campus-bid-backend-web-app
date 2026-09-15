import "dotenv/config";
import mongoose from "mongoose";

/**
 * One-time migration to run before deploying the `isActive` default flip
 * (true -> false) on the Vendor schema. Without this, any vendor document
 * that is missing the `isActive` field would silently read as `false` on
 * next hydration, deactivating a real vendor with no write ever happening.
 *
 * Usage: npm run backfill-vendor-isactive
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);

  const result = await mongoose.connection
    .collection("vendors")
    .updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });

  console.log(`Backfilled isActive=true on ${result.modifiedCount} vendor(s) missing the field.`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
