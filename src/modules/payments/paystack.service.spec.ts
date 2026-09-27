import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
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
  });
});
