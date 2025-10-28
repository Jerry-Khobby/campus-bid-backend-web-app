import { IsMongoId, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Types } from 'mongoose';

export class CompleteFlashSaleDto {
  @IsMongoId()
  @IsNotEmpty()
  flashSaleId: Types.ObjectId;

  @IsMongoId()
  @IsNotEmpty()
  winner: Types.ObjectId;

  @IsNumber()
  @Min(0)
  finalBid: number;
}
