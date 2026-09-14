import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PaymentsController } from './payment.controller';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentsService } from './payment.service';
import { PaystackService } from './paystack.service';
import { PayoutsService } from './payouts.service';
import { Payment, PaymentSchema } from './schema/payment.schema';
import { Payout, PayoutSchema } from './schema/payout.schema';
import { Order, OrderSchema } from '../orders/schema/order.schema';
import { Vendor, VendorSchema } from '../vendors/schema/vendor.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Payout.name, schema: PayoutSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Vendor.name, schema: VendorSchema },
    ]),
  ],
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [PaymentsService, PaystackService, PayoutsService],
  exports: [PaymentsService, PayoutsService], // <-- Exported for other modules (e.g. vendor dashboard/payouts routes) to inject
})
export class PaymentsModule {}
