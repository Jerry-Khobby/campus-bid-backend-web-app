import type { IncomingMessage } from 'http';

const DEFAULT_CORS_ORIGINS = 'http://localhost:5000,http://localhost:5001,http://localhost:5002';

type OriginCallback = (error: Error | null, allow?: boolean) => void;
type RequestCallback = (error: string | null, success: boolean) => void;

// Read lazily: gateway decorators are evaluated before ConfigModule has loaded .env.
export function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((origin) => origin.trim());
}

// Non-browser clients send no Origin header; they are still subject to JWT authentication.
export function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || getAllowedOrigins().includes(origin);
}

function allowCorsOrigin(origin: string | undefined, callback: OriginCallback): void {
  callback(null, isAllowedOrigin(origin));
}

// `cors` only covers HTTP long-polling; `allowRequest` also covers the WebSocket upgrade.
function allowHandshake(request: IncomingMessage, callback: RequestCallback): void {
  callback(null, isAllowedOrigin(request.headers.origin));
}

/** Socket.IO server options shared by every gateway (Nest builds one server per port from the first gateway). */
export const SOCKET_SERVER_OPTIONS = {
  cors: { origin: allowCorsOrigin },
  allowRequest: allowHandshake,
};
