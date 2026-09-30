import "dotenv/config";
import mongoose from "mongoose";

/**
 * One-time migration: order.paymentId was never actually written by
 * createPendingPayment until now, so every existing order has no record of
 * its own payment. Cancelling, disputing, and releasing payment on delivery
 * all read this field, so without it those actions silently no-op instead
 * of acting on the real payment. Backfills by matching each order to the
 * most recent Payment document with a matching orderId.
 *
 * Usage: npm run backfill-order-payment-link
 */
async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);

  const orders = mongoose.connection
    .collection("orders")
    .find({ paymentId: { $exists: false } }, { projection: { _id: 1 } });

  let matched = 0;
  let skipped = 0;
  for await (const order of orders) {
    const payment = await mongoose.connection
      .collection("payments")
      .find({ orderId: order._id })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();

    if (!payment) {
      skipped++;
      continue;
    }

    await mongoose.connection
      .collection("orders")
      .updateOne({ _id: order._id }, { $set: { paymentId: payment._id } });
    matched++;
  }

  console.log(`Linked ${matched} order(s) to their payment. ${skipped} had no payment to link.`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
