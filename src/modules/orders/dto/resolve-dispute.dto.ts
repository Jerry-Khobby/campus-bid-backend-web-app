import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { DISPUTE_RESOLUTIONS, DISPUTE_TEXT_MAX_LENGTH, DISPUTE_NOTE_MIN_LENGTH, type DisputeResolution } from '../order.constants';

export class ResolveDisputeDto {
  @ApiProperty({ enum: DISPUTE_RESOLUTIONS, description: 'refund the customer, or release the payment to the vendor' })
  @IsIn(DISPUTE_RESOLUTIONS)
  resolution: DisputeResolution;

  @ApiProperty({ description: 'Why the admin decided this way; shown to both parties' })
  @IsString()
  @MinLength(DISPUTE_NOTE_MIN_LENGTH)
  @MaxLength(DISPUTE_TEXT_MAX_LENGTH)
  note: string;
}
