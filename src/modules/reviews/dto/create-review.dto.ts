import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

const MIN_RATING = 1;
const MAX_RATING = 5;

class ProductRatingItemDto {
  @ApiProperty({ example: "6531cdef1234567890abcd12" })
  @IsMongoId()
  productId: string;

  @ApiProperty({ example: 4 })
  @IsNumber()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating: number;
}

export class CreateReviewDto {
  @ApiProperty({ example: "6531cdef1234567890abcd12" })
  @IsMongoId()
  orderId: string;

  @ApiProperty({ example: "6531cdef1234567890abcd34" })
  @IsMongoId()
  vendorId: string;

  @ApiProperty({ example: 5, description: "Overall vendor rating" })
  @IsNumber()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating: number;

  @ApiPropertyOptional({ example: "Great service and fast delivery!" })
  @IsOptional()
  @IsString()
  review?: string;

  @ApiProperty({ type: [ProductRatingItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductRatingItemDto)
  productRatings: ProductRatingItemDto[];
}
