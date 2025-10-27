import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Min, IsMongoId } from "class-validator";

export class UpdateStockDto {
  @ApiProperty({ description: "Product ID", example: "6531cdef1234567890abcd12" })
  @IsMongoId()
  productId: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0)
  stock: number;
}
