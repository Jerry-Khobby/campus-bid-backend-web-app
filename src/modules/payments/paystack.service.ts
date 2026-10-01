import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
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

export interface CreateRecipientResult {
  recipient_code: string;
  [key: string]: any;
}

export interface TransferResult {
  status: string;
  transfer_code: string;
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

  // Registers a payout destination with Paystack ahead of a transfer. For
  // Ghana mobile money, 'bank_code' is the network's List Banks code (MTN,
  // VOD, ATL) - confirmed against Paystack's live /bank endpoint. This is
  // uppercase and NOT the same value used for mobile_money charges
  // elsewhere in this file, which takes the lowercase provider code instead.
  async createTransferRecipient(
    name: string,
    accountNumber: string,
    momoProvider: string,
  ): Promise<CreateRecipientResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transferrecipient`,
        {
          type: 'mobile_money',
          name,
          account_number: accountNumber,
          bank_code: momoProvider.toUpperCase(),
          currency: 'GHS',
        },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      return response.data.data;
    } catch (err) {
      this.logger.error('Error creating Paystack transfer recipient', err);
      throw new BadRequestException(this.extractGatewayErrorMessage(err) ?? 'Payment gateway error');
    }
  }

  // Actually sends money out to a recipient. Paystack rejects a reused
  // `reference` with a duplicate-transfer error rather than sending twice -
  // callers should pass the same reference on every retry of the same
  // payout so that guarantee backs up our own idempotency checks.
  async initiateTransfer(
    recipientCode: string,
    amountPesewas: number,
    reference: string,
    reason: string,
  ): Promise<TransferResult> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transfer`,
        {
          source: 'balance',
          amount: amountPesewas,
          recipient: recipientCode,
          reference,
          reason,
        },
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
      return response.data.data;
    } catch (err) {
      this.logger.error('Error initiating Paystack transfer', err);
      throw new BadRequestException(this.extractGatewayErrorMessage(err) ?? 'Payment gateway error');
    }
  }

  // Paystack's validation errors (bad recipient, account restrictions, etc.)
  // come back with a human-readable 'message' that's safe and useful to show
  // an admin directly, rather than burying it behind a generic failure -
  // this is the only piece of the error response trusted here, never the
  // raw body, to avoid leaking anything unexpected from the gateway.
  private extractGatewayErrorMessage(err: unknown): string | undefined {
    if (axios.isAxiosError(err)) {
      const message = err.response?.data?.message;
      if (typeof message === 'string') return message;
    }
    return undefined;
  }

  async verifyTransfer(reference: string): Promise<TransferResult> {
    try {
      const response = await axios.get(`${this.baseUrl}/transfer/${reference}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });
      return response.data.data;
    } catch (err) {
      this.logger.error('Error verifying Paystack transfer', err);
      throw new InternalServerErrorException('Payment gateway error');
    }
  }

  // Recomputes the HMAC-SHA512 signature Paystack sends and compares it to the
  // one on the webhook request, confirming the payload genuinely came from Paystack.
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!this.secretKey || !signature) return false;

    const expected = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest();
    const received = Buffer.from(signature, 'hex');

    // timingSafeEqual throws on unequal lengths, so the length check must come first.
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }
}
