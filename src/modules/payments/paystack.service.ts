import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

interface InitializeTransactionResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface VerifyTransactionResult {
  status: string;
  amount: number;
  reference: string;
  [key: string]: any;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly baseUrl = 'https://api.paystack.co';

  constructor(private readonly configService: ConfigService) {}

  private get secretKey(): string {
    return this.configService.get<string>('PAYSTACK_SECRET_KEY')!;
  }

  async initializeTransaction(
    email: string,
    amountKobo: number,
    reference: string,
    callbackUrl: string,
  ): Promise<InitializeTransactionResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        { email, amount: amountKobo, reference, callback_url: callbackUrl },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      return response.data.data;
    } catch (err) {
      this.logger.error('Error initializing Paystack transaction', err);
      throw new InternalServerErrorException('Payment gateway error');
    }
  }

  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    try {
      const response = await axios.get(`${this.baseUrl}/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });
      return response.data.data;
    } catch (err) {
      this.logger.error('Error verifying Paystack transaction', err);
      throw new InternalServerErrorException('Payment gateway error');
    }
  }

  // Recomputes the HMAC-SHA512 signature Paystack sends and compares it to the
  // one on the webhook request, confirming the payload genuinely came from Paystack.
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const hash = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    return hash === signature;
  }
}
