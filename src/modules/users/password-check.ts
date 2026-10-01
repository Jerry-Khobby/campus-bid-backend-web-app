import * as bcrypt from "bcrypt";
import { randomBytes } from "crypto";

const DUMMY_PASSWORD_BYTES = 16;
const dummyHashesBySaltRounds = new Map<number, Promise<string>>();

// Accounts without a stored password (unknown email, Google-only) are still compared
// against a throwaway hash of the same cost, so they answer as slowly as a wrong password
// and response timing can't be used to enumerate accounts.
export async function isPasswordCorrect(
  storedHash: string | null | undefined,
  candidatePassword: string,
  saltRounds: number,
): Promise<boolean> {
  const hashToCompare = storedHash ?? (await getDummyHash(saltRounds));
  const isMatch = await bcrypt.compare(candidatePassword, hashToCompare);
  return isMatch && Boolean(storedHash);
}

function getDummyHash(saltRounds: number): Promise<string> {
  if (!dummyHashesBySaltRounds.has(saltRounds)) {
    const throwawayPassword = randomBytes(DUMMY_PASSWORD_BYTES).toString("hex");
    dummyHashesBySaltRounds.set(saltRounds, bcrypt.hash(throwawayPassword, saltRounds));
  }
  return dummyHashesBySaltRounds.get(saltRounds) as Promise<string>;
}
