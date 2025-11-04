import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateNotificationDto {
  @IsNotEmpty()
  userId: string;

  @IsEnum(['customer', 'vendor'])
  userType: 'customer' | 'vendor';

  @IsEnum(['order_update', 'new_message', 'flash_sale', 'payment'])
  type: 'order_update' | 'new_message' | 'flash_sale' | 'payment';

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  data?: Record<string, any>;
}
