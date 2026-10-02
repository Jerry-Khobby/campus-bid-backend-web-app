import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MarkDeliveredDto } from './mark-delivered.dto';

const errorsFor = (deliveryCode: unknown) =>
  validateSync(plainToInstance(MarkDeliveredDto, { deliveryCode }));

describe('MarkDeliveredDto', () => {
  it('accepts a six-digit code', () => {
    expect(errorsFor('482193')).toHaveLength(0);
  });

  it('accepts a code with leading zeros', () => {
    expect(errorsFor('000123')).toHaveLength(0);
  });

  it('accepts the four-digit code of an older order', () => {
    expect(errorsFor('4821')).toHaveLength(0);
  });

  it.each(['12', '12345', '1234567', '12a456', ' 482193'])('rejects %p', (code) => {
    expect(errorsFor(code)).not.toHaveLength(0);
  });
});
