import { ApiProperty } from "@nestjs/swagger";
import { IsMongoId, IsNumber, Min, Max } from "class-validator";

export class ProductRatingDto {
  @ApiProperty({ example: "6531cdef1234567890abcd12" })
  @IsMongoId()
  productId: string;

  @ApiProperty({ example: 4.5, description: "Rating value between 1 and 5" })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;
}
