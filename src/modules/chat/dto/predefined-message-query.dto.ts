import { IsIn, IsOptional, IsString } from 'class-validator';

export class PredefinedMessageQueryDto {
  @IsOptional()
  @IsIn(['customer', 'vendor'])
  role?: 'customer' | 'vendor';

  @IsOptional()
  @IsString()
  category?: string;
}
