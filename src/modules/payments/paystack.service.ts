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

export interface ChargeMobileMoneyResult {
  status: string;
  display_text?: string;
  reference: string;
  [key: string]: any;
}

export interface SubmitOtpResult {
  status: string;
  [key: string]: any;
}

export interface RefundResult {
  status: string;
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
    amountPesewas: number,
    reference: string,
    callbackUrl: string,
  ): Promise<InitializeTransactionResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        { email, amount: amountPesewas, currency: 'GHS', reference, callback_url: callbackUrl },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      return response.data.data;
    } catch (err) {
      this.logger.error('Error initializing Paystack transaction', err);
      throw new InternalServerErrorException('Payment gateway error');
    }
  }

  // Direct Mobile Money charge (Paystack's Charge API) - unlike
  // initializeTransaction, this never redirects the customer to a hosted
  // page. Paystack responds with one of a few statuses depending on the
  // network: 'send_otp' (customer needs to type an OTP back, via submitOtp),
  // 'pay_offline' (customer approves a USSD/app prompt on their phone - no
  // further action needed from us besides polling /transaction/verify), or
  // occasionally an immediate 'success'/'failed'.
  async chargeMobileMoney(
    email: string,
    amountPesewas: number,
    reference: string,
    phone: string,
    provider: string,
  ): Promise<ChargeMobileMoneyResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/charge`,
        {
          email,
          amount: amountPesewas,
          currency: 'GHS',
          reference,
          mobile_money: { phone, provider },
        },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      return response.data.data;
    } catch (err) {
      this.logger.error('Error charging mobile money', err);
      throw new InternalServerErrorException('Payment gateway error');
    }
  }

  // Second step of the 'send_otp' flow above - submits the code the customer
  // received by SMS from their provider back to Paystack to authorize the charge.
  async submitOtp(reference: string, otp: string): Promise<SubmitOtpResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/charge/submit_otp`,
        { reference, otp },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      return response.data.data;
    } catch (err) {
      this.logger.error('Error submitting mobile money OTP', err);
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

  // Actually sends the customer's money back, via Paystack's own refund API -
  // reversing the original charge rather than just flipping a status in our
  // own database. Paystack processes refunds asynchronously; the immediate
  // response just confirms the request was accepted.
  async refundTransaction(reference: string): Promise<RefundResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/refund`,
        { transaction: reference },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      return response.data.data;
    } catch (err) {
      this.logger.error('Error refunding Paystack transaction', err);
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
