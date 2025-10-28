import {
  IsOptional,
  IsNumber,
  IsMongoId,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { Types } from 'mongoose';
import { FlashSaleStatus, FlashSaleReason } from './enums';

export class UpdateFlashSaleDto {
  @IsOptional()
  @IsNumber()
  originalPrice?: number;

  @IsOptional()
  @IsNumber()
  startingBid?: number;

  @IsOptional()
  @IsNumber()
  currentBid?: number;

  @IsOptional()
  @IsMongoId()
  currentBidder?: Types.ObjectId;

  @IsOptional()
  @IsNumber()
  minimumBidIncrement?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsDateString()
  startTime?: Date;

  @IsOptional()
  @IsDateString()
  endTime?: Date;

  @IsOptional()
  @IsEnum(FlashSaleStatus)
  status?: FlashSaleStatus;

  @IsOptional()
  @IsEnum(FlashSaleReason)
  reason?: FlashSaleReason;

  @IsOptional()
  @IsMongoId()
  winner?: Types.ObjectId;
}
