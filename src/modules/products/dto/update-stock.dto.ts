import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, Min } from "class-validator";

export class UpdateStockDto {
  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0)
  stock: number;
}
