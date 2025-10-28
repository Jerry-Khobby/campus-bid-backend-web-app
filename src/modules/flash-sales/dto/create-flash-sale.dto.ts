import { IsOptional, ValidateNested, IsMongoId } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseFlashSaleDto } from './base-flash-sale.dto';
import { BidDto } from './bid.dto';
import { Types } from 'mongoose';

export class CreateFlashSaleDto extends BaseFlashSaleDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BidDto)
  bids?: BidDto[];

  @IsOptional()
  @IsMongoId()
  winner?: Types.ObjectId;
}
