import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { DISPUTE_TEXT_MAX_LENGTH, DISPUTE_REASON_MIN_LENGTH } from '../order.constants';

export class OpenDisputeDto {
  @ApiProperty({ description: 'What went wrong with the delivered order' })
  @IsString()
  @MinLength(DISPUTE_REASON_MIN_LENGTH)
  @MaxLength(DISPUTE_TEXT_MAX_LENGTH)
  reason: string;
}
