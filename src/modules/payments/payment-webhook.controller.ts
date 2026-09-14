import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentsService } from './payment.service';

// Public route — Paystack calls this directly, so it intentionally carries no
// auth guards. Authenticity is instead verified via the HMAC signature header.
@ApiExcludeController()
@Controller('payments/webhook')
export class PaymentWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('paystack')
  async handlePaystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
    @Body() event: any,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody as Buffer, signature, event);
  }
}
