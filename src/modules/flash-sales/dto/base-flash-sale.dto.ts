import {
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsMongoId,
  IsDateString,
  IsEnum,
  Min,
} from 'class-validator';
import { Types } from 'mongoose';
import { FlashSaleStatus, FlashSaleReason } from './enums';

export class BaseFlashSaleDto {
  @IsMongoId()
  @IsNotEmpty()
  vendorId: Types.ObjectId;

  @IsMongoId()
  @IsNotEmpty()
  productId: Types.ObjectId;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  originalPrice: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  startingBid: number;

  @IsOptional()
  @IsNumber()
  currentBid?: number;

  @IsOptional()
  @IsMongoId()
  currentBidder?: Types.ObjectId;

  @IsOptional()
  @IsNumber()
  @Min(1)
  minimumBidIncrement?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsDateString()
  @IsNotEmpty()
  startTime: Date;

  @IsDateString()
  @IsNotEmpty()
  endTime: Date;

  @IsOptional()
  @IsEnum(FlashSaleStatus)
  status?: FlashSaleStatus;

  @IsOptional()
  @IsEnum(FlashSaleReason)
  reason?: FlashSaleReason;
}
