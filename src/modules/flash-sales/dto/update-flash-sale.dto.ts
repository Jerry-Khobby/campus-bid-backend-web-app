import { PartialType, OmitType } from '@nestjs/swagger';
import { BaseFlashSaleDto } from './base-flash-sale.dto';

export class UpdateFlashSaleDto extends PartialType(OmitType(BaseFlashSaleDto, ['productId'] as const)) {}
