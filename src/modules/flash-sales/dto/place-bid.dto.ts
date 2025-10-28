import { IsMongoId, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Types } from 'mongoose';

export class PlaceBidDto {
  @IsMongoId()
  @IsNotEmpty()
  flashSaleId: Types.ObjectId;

  @IsMongoId()
  @IsNotEmpty()
  userId: Types.ObjectId;

  @IsNumber()
  @Min(0)
  amount: number;
}
