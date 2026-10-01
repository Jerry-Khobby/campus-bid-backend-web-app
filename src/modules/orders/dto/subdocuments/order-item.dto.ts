import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Min } from 'class-validator';

// Only what the customer chooses. Name, image and price are snapshotted from
// the product catalogue on the server so the client can't set its own price.
export class OrderItemDto {
  @ApiProperty()
  @IsMongoId()
  productId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;
}
