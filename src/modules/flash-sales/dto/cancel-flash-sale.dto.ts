import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';
import { Types } from 'mongoose';

export class CancelFlashSaleDto {
  @IsMongoId()
  @IsNotEmpty()
  flashSaleId: Types.ObjectId;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
