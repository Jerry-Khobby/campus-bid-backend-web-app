import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitMomoOtpDto {
  @ApiProperty({ description: 'The OTP the customer received from their mobile money provider' })
  @IsString()
  @IsNotEmpty()
  otp: string;
}
