import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { PaystackService } from './paystack.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PaystackService', () => {
  let service: PaystackService;
  const SECRET_KEY = 'sk_test_secret';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaystackService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(SECRET_KEY) },
        },
      ],
    }).compile();

    service = module.get<PaystackService>(PaystackService);
    jest.clearAllMocks();
  });

  describe('initializeTransaction', () => {
    it('returns the gateway data on success', async () => {
      const gatewayData = {
        authorization_url: 'https://paystack.com/pay/xyz',
        access_code: 'access123',
        reference: 'ref123',
      };
      mockedAxios.post.mockResolvedValue({ data: { data: gatewayData } });

      const result = await service.initializeTransaction('a@b.com', 10000, 'ref123', 'https://cb.url');

      expect(result).toEqual(gatewayData);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/initialize',
        { email: 'a@b.com', amount: 10000, currency: 'GHS', reference: 'ref123', callback_url: 'https://cb.url' },
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws InternalServerErrorException when the gateway call fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'));

      await expect(
        service.initializeTransaction('a@b.com', 10000, 'ref123', 'https://cb.url'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('verifyTransaction', () => {
    it('returns the verification data on success', async () => {
      const verificationData = { status: 'success', amount: 10000, reference: 'ref123' };
      mockedAxios.get.mockResolvedValue({ data: { data: verificationData } });

      const result = await service.verifyTransaction('ref123');

      expect(result).toEqual(verificationData);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/verify/ref123',
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws InternalServerErrorException when the gateway call fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('network down'));

      await expect(service.verifyTransaction('ref123')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('chargeMobileMoney', () => {
    it('sends the charge request and returns the gateway status', async () => {
      const gatewayData = { status: 'pay_offline', display_text: 'Approve on your phone', reference: 'ref123' };
      mockedAxios.post.mockResolvedValue({ data: { data: gatewayData } });

      const result = await service.chargeMobileMoney('a@b.com', 10000, 'ref123', '0551234567', 'mtn');

      expect(result).toEqual(gatewayData);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.paystack.co/charge',
        {
          email: 'a@b.com',
          amount: 10000,
          currency: 'GHS',
          reference: 'ref123',
          mobile_money: { phone: '0551234567', provider: 'mtn' },
        },
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws InternalServerErrorException when the gateway call fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'));

      await expect(
        service.chargeMobileMoney('a@b.com', 10000, 'ref123', '0551234567', 'mtn'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('submitOtp', () => {
    it('submits the OTP and returns the resulting status', async () => {
      mockedAxios.post.mockResolvedValue({ data: { data: { status: 'success' } } });

      const result = await service.submitOtp('ref123', '123456');

      expect(result).toEqual({ status: 'success' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.paystack.co/charge/submit_otp',
        { reference: 'ref123', otp: '123456' },
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws InternalServerErrorException when the gateway call fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'));

      await expect(service.submitOtp('ref123', '123456')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('refundTransaction', () => {
    it('requests a refund and returns the gateway status', async () => {
      const refundData = { status: 'pending', amount: 10000 };
      mockedAxios.post.mockResolvedValue({ data: { data: refundData } });

      const result = await service.refundTransaction('ref123');

      expect(result).toEqual(refundData);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.paystack.co/refund',
        { transaction: 'ref123' },
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws InternalServerErrorException when the gateway call fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'));

      await expect(service.refundTransaction('ref123')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('createTransferRecipient', () => {
    it('uppercases the momo provider code - Paystack rejects the lowercase charge-API code', async () => {
      const recipientData = { recipient_code: 'RCP_abc123' };
      mockedAxios.post.mockResolvedValue({ data: { data: recipientData } });

      const result = await service.createTransferRecipient('Jane Vendor', '0551234987', 'mtn');

      expect(result).toEqual(recipientData);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.paystack.co/transferrecipient',
        {
          type: 'mobile_money',
          name: 'Jane Vendor',
          account_number: '0551234987',
          bank_code: 'MTN',
          currency: 'GHS',
        },
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws BadRequestException with a generic message for a non-gateway failure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'));

      await expect(
        service.createTransferRecipient('Jane Vendor', '0551234987', 'mtn'),
      ).rejects.toThrow(BadRequestException);
    });

    it('surfaces Paystack\'s own validation message instead of a generic failure', async () => {
      const axiosError = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { data: { message: 'Bank is invalid' } },
      });
      mockedAxios.post.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValueOnce(true as any);

      await expect(
        service.createTransferRecipient('Jane Vendor', '0551234987', 'mtn'),
      ).rejects.toThrow('Bank is invalid');
    });
  });

  describe('initiateTransfer', () => {
    it('sends the transfer request and returns the gateway status', async () => {
      const transferData = { status: 'pending', transfer_code: 'TRF_abc', reference: 'ref123' };
      mockedAxios.post.mockResolvedValue({ data: { data: transferData } });

      const result = await service.initiateTransfer('RCP_abc123', 4500, 'ref123', 'CampusBid payout');

      expect(result).toEqual(transferData);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.paystack.co/transfer',
        {
          source: 'balance',
          amount: 4500,
          recipient: 'RCP_abc123',
          reference: 'ref123',
          reason: 'CampusBid payout',
        },
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws BadRequestException with a generic message for a non-gateway failure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network down'));

      await expect(
        service.initiateTransfer('RCP_abc123', 4500, 'ref123', 'CampusBid payout'),
      ).rejects.toThrow(BadRequestException);
    });

    it('surfaces Paystack\'s own rejection reason, e.g. an account-tier restriction', async () => {
      const axiosError = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { data: { message: 'You cannot initiate third party payouts as a starter business' } },
      });
      mockedAxios.post.mockRejectedValue(axiosError);
      jest.spyOn(axios, 'isAxiosError').mockReturnValueOnce(true as any);

      await expect(
        service.initiateTransfer('RCP_abc123', 4500, 'ref123', 'CampusBid payout'),
      ).rejects.toThrow('You cannot initiate third party payouts as a starter business');
    });
  });

  describe('verifyTransfer', () => {
    it('returns the transfer status on success', async () => {
      const transferData = { status: 'success', transfer_code: 'TRF_abc', reference: 'ref123' };
      mockedAxios.get.mockResolvedValue({ data: { data: transferData } });

      const result = await service.verifyTransfer('ref123');

      expect(result).toEqual(transferData);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.paystack.co/transfer/ref123',
        { headers: { Authorization: `Bearer ${SECRET_KEY}` } },
      );
    });

    it('throws InternalServerErrorException when the gateway call fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('network down'));

      await expect(service.verifyTransfer('ref123')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns true when the signature matches the computed hash', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const validSignature = crypto.createHmac('sha512', SECRET_KEY).update(rawBody).digest('hex');

      expect(service.verifyWebhookSignature(rawBody, validSignature)).toBe(true);
    });

    it('returns false when the signature does not match', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));

      expect(service.verifyWebhookSignature(rawBody, 'invalid-signature')).toBe(false);
    });

    it('returns false for a same-length signature that differs', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));
      const forgedSignature = crypto.createHmac('sha512', 'wrong-key').update(rawBody).digest('hex');

      expect(service.verifyWebhookSignature(rawBody, forgedSignature)).toBe(false);
    });

    it('returns false when the signature is missing', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success' }));

      expect(service.verifyWebhookSignature(rawBody, undefined as unknown as string)).toBe(false);
    });
  });
});
