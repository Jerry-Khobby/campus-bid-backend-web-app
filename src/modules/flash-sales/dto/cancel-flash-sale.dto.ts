import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';
import { Types } from 'mongoose';
import { FlashSaleReason } from './enums';

export class CancelFlashSaleDto {
  @IsMongoId()
  @IsNotEmpty()
  flashSaleId: Types.ObjectId;

  @IsString()
  @IsNotEmpty()
  reason: FlashSaleReason;
}
