import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_MESSAGES_PAGE_SIZE = 30;
export const MAX_MESSAGES_PAGE_SIZE = 100;

export class MessagesPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGES_PAGE_SIZE)
  limit: number = DEFAULT_MESSAGES_PAGE_SIZE;
}
