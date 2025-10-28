import { IsOptional, IsMongoId, IsEnum, IsDateString, IsNumber, Min } from 'class-validator';
import { Types } from 'mongoose';
import { FlashSaleStatus } from './enums';

export class FlashSaleQueryDto {
  @IsOptional()
  @IsEnum(FlashSaleStatus)
  status?: FlashSaleStatus;

  @IsOptional()
  @IsMongoId()
  vendorId?: Types.ObjectId;

  @IsOptional()
  @IsMongoId()
  productId?: Types.ObjectId;

  @IsOptional()
  @IsDateString()
  startAfter?: Date;

  @IsOptional()
  @IsDateString()
  endBefore?: Date;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minBid?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxBid?: number;
}
