import { IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsDateString, Min } from 'class-validator';
import { Types } from 'mongoose';

export class BidDto {
  @IsMongoId()
  @IsNotEmpty()
  userId: Types.ObjectId;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsDateString()
  timestamp?: Date;
}
