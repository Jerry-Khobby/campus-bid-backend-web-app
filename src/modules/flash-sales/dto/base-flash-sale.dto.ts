import {
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsMongoId,
  IsDateString,
  Min,
} from 'class-validator';
import { Types } from 'mongoose';

// Bid state (currentBid, currentBidder, bids, winner) and lifecycle state (status,
// reason) are server-controlled, so they are deliberately absent from client input.
export class BaseFlashSaleDto {
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
}
