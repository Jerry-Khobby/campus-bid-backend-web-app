import "dotenv/config";
import mongoose from "mongoose";

/**
 * Promotes an already-registered user to the "admin" role. Public
 * registration can never set role:"admin" (see CreateUserDto), so the
 * person must register normally as a student first via POST /users/register,
 * then this script promotes their existing account by email. This avoids
 * re-implementing password hashing in a standalone script.
 *
 * Usage: npm run create-admin -- <email>
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run create-admin -- <email>");
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);

  const result = await mongoose.connection
    .collection("users")
    .updateOne({ email }, { $set: { role: "admin" } });

  if (result.matchedCount === 0) {
    console.error(
      `No user found with email "${email}". Register the account first via POST /users/register, then run this script.`,
    );
    process.exit(1);
  }

  console.log(`"${email}" is now an admin.`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Failed to promote user to admin:", error);
  process.exit(1);
});
