import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerModuleOptions } from "@nestjs/throttler";

const ONE_MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * ONE_MINUTE_MS;
const DEFAULT_REQUESTS_PER_MINUTE = 300;
const SENSITIVE_ATTEMPTS_PER_WINDOW = 10;

export const DEFAULT_THROTTLE: ThrottlerModuleOptions = [
  { name: "default", ttl: ONE_MINUTE_MS, limit: DEFAULT_REQUESTS_PER_MINUTE },
];

// Apply with @Throttle(SENSITIVE_THROTTLE) to login, password-reset, OTP and
// delivery-code routes, where every request is a guess an attacker gets for free.
export const SENSITIVE_THROTTLE = {
  default: { ttl: FIFTEEN_MINUTES_MS, limit: SENSITIVE_ATTEMPTS_PER_WINDOW },
};

@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  // WebSocket gateways carry no HTTP request/response, which the base guard needs.
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== "http";
  }

  // Campus networks put many students behind one NAT address, so counting by IP
  // alone would let one person's failed logins lock out everyone on campus.
  // Pairing the IP with the targeted email confines a lockout to that account.
  protected async getTracker(request: Record<string, any>): Promise<string> {
    const clientIp = String(request.ip);
    const targetEmail: unknown = request.body?.email;

    if (typeof targetEmail !== "string") return clientIp;

    return `${clientIp}:${targetEmail.trim().toLowerCase()}`;
  }
}
