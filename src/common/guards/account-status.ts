const VENDOR_ROLE = "vendor";
const VENDOR_MODEL_NAME = "Vendor";
const USER_MODEL_NAME = "User";

// Students and admins are User documents; vendors have their own model.
export function getAccountModelName(role: string): string {
  return role === VENDOR_ROLE ? VENDOR_MODEL_NAME : USER_MODEL_NAME;
}

export function getAccountStatusCacheKey(role: string, accountId: string): string {
  return `account-active:${getAccountModelName(role)}:${accountId}`;
}
