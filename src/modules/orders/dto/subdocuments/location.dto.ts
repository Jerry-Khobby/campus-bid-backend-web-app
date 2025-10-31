import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class LocationDto {
  @ApiProperty({ example: 'Point' })
  @IsString()
  type: 'Point';

  @ApiProperty({ example: [-0.187, 5.6037] })
  @IsArray()
  coordinates: [number, number];
}
