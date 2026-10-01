import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFlashSaleDto } from './update-flash-sale.dto';
import { CreateFlashSaleDto } from './create-flash-sale.dto';

const STRICT_WHITELIST = { whitelist: true, forbidNonWhitelisted: true };

async function rejectedProperties(dtoClass: any, body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(dtoClass, body), STRICT_WHITELIST);
  return errors.map((error) => error.property);
}

describe('UpdateFlashSaleDto', () => {
  it.each(['currentBid', 'currentBidder', 'winner', 'status', 'bids', 'reason', 'productId'])(
    'rejects the server-controlled field %s',
    async (field) => {
      const rejected = await rejectedProperties(UpdateFlashSaleDto, { [field]: 'x' });

      expect(rejected).toContain(field);
    },
  );

  it('accepts schedule and pricing fields', async () => {
    const rejected = await rejectedProperties(UpdateFlashSaleDto, {
      startingBid: 10,
      originalPrice: 20,
      minimumBidIncrement: 2,
      quantity: 1,
      startTime: '2030-01-01T00:00:00.000Z',
      endTime: '2030-01-02T00:00:00.000Z',
    });

    expect(rejected).toEqual([]);
  });
});

describe('CreateFlashSaleDto', () => {
  it.each(['currentBid', 'currentBidder', 'winner', 'status', 'bids'])(
    'rejects the server-controlled field %s',
    async (field) => {
      const rejected = await rejectedProperties(CreateFlashSaleDto, { [field]: 'x' });

      expect(rejected).toContain(field);
    },
  );
});
