import "dotenv/config";
import mongoose from "mongoose";

/**
 * One-time migration for the delivery-code feature: every order placed
 * before it existed has no deliveryCode, and since a missing code can never
 * match anything a vendor submits, those orders could never be marked
 * delivered again without this. Each gets its own random 4-digit code, same
 * as a newly created order would.
 *
 * Usage: npm run backfill-delivery-code
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);

  const orders = mongoose.connection
    .collection("orders")
    .find({ deliveryCode: { $exists: false } }, { projection: { _id: 1 } });

  let count = 0;
  for await (const order of orders) {
    const deliveryCode = String(Math.floor(1000 + Math.random() * 9000));
    await mongoose.connection
      .collection("orders")
      .updateOne({ _id: order._id }, { $set: { deliveryCode } });
    count++;
  }

  console.log(`Backfilled a delivery code on ${count} order(s) missing one.`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
