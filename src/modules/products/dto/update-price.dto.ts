import { ApiProperty } from "@nestjs/swagger";
import { IsMongoId, IsNumber, Min, IsOptional } from "class-validator";

export class UpdatePriceDto {
  @ApiProperty({ example: "6531cdef1234567890abcd12" })
  @IsMongoId()
  productId: string;

  @ApiProperty({ example: 25.99 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 19.99, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPrice?: number;
}
