import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateNotificationDto {
  @IsNotEmpty()
  userId: string;

  @IsEnum(['customer', 'vendor'])
  userType: 'customer' | 'vendor';

  @IsEnum([
    'order_update',
    'new_message',
    'flash_sale',
    'payment',
    'order_status_changed',
    'flash_sale_alert',
    'flash_sale_won',
  ])
  type:
    | 'order_update'
    | 'new_message'
    | 'flash_sale'
    | 'payment'
    | 'order_status_changed'
    | 'flash_sale_alert'
    | 'flash_sale_won';

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  data?: Record<string, any>;
}
