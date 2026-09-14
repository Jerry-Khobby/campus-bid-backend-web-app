import { IsNumber, Min } from 'class-validator';

export class PlaceBidDto {
  @IsNumber()
  @Min(0)
  amount: number;
}
