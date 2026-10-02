import { ConflictException } from '@nestjs/common';
import { OrderStatus } from './dto/order-status.enum';

// The single source of truth for how an order may move. Every status write
// in OrdersService goes through assertTransitionAllowed, so a route can only
// narrow these rules (e.g. vendors may reject only pending orders), never widen them.
// Cancelling is possible only before the vendor starts preparing. A delivered
// order the customer disputes waits for an admin to refund or release it.
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
  [OrderStatus.READY]: [OrderStatus.OUT_FOR_DELIVERY],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED, OrderStatus.DISPUTED],
  [OrderStatus.DISPUTED]: [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

// The only statuses a vendor may set through the generic status route.
// DELIVERED needs the customer's code and COMPLETED needs the customer's
// confirmation, so both have their own routes.
export const VENDOR_PROGRESS_STATUSES = [
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
];

export function assertTransitionAllowed(from: string, to: OrderStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from as OrderStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException(`An order cannot move from '${from}' to '${to}'`);
  }
}
