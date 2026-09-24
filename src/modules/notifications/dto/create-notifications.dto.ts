import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateNotificationDto {
  @IsNotEmpty()
  userId: string;

  @IsEnum(['customer', 'vendor', 'admin'])
  userType: 'customer' | 'vendor' | 'admin';

  @IsEnum([
    'order_update',
    'new_message',
    'flash_sale',
    'payment',
    'order_status_changed',
    'flash_sale_alert',
    'flash_sale_won',
    'payment_disputed',
  ])
  type:
    | 'order_update'
    | 'new_message'
    | 'flash_sale'
    | 'payment'
    | 'order_status_changed'
    | 'flash_sale_alert'
    | 'flash_sale_won'
    | 'payment_disputed';

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  data?: Record<string, any>;
}
