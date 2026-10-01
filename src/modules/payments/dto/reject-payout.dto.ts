import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RejectPayoutDto {
  @ApiProperty({ description: 'Why this payout request is being declined' })
  @IsString()
  @MinLength(3)
  reason: string;
}
