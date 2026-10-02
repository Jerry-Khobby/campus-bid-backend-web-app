// Flat fees in GHS. The customer checkout shows the same values as an
// estimate (campusbid-ecommerce-frontend-web-app/lib/constants.ts); the
// amounts stored here are what Paystack actually charges.
export const DELIVERY_FEE = 2;
export const SERVICE_FEE = 0;

export const CENTS_PER_UNIT = 100;
export const MINUTES_TO_MILLISECONDS = 60_000;

export const ORDER_NUMBER_SUFFIX_RANGE = 1000;

export const DELIVERY_CODE_LENGTH = 6;
export const MAX_DELIVERY_CODE_ATTEMPTS = 5;

export const DISPUTE_RESOLUTIONS = ['refund', 'release'] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];
export const DISPUTE_REASON_MIN_LENGTH = 10;
export const DISPUTE_NOTE_MIN_LENGTH = 3;
export const DISPUTE_TEXT_MAX_LENGTH = 1000;

// Payment errors below this status are business-rule rejections worth showing as-is.
export const HTTP_SERVER_ERROR = 500;
