import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class UpdateAvailabilityDto {
  @ApiProperty({ example: true, description: "Whether the product is available for purchase" })
  @IsBoolean()
  isAvailable: boolean;
}
