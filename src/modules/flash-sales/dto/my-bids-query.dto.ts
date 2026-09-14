import { IsIn, IsOptional } from 'class-validator';

export type BidStatus = 'active' | 'won' | 'lost';

export class MyBidsQueryDto {
  @IsOptional()
  @IsIn(['active', 'won', 'lost'])
  status?: BidStatus;
}
