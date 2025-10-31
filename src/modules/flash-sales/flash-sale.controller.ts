import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { FlashSaleService } from './flash-sale.service';
import {
  CreateFlashSaleDto,
  UpdateFlashSaleDto,
  PlaceBidDto,
  CancelFlashSaleDto,
  CompleteFlashSaleDto,
  FlashSaleQueryDto,
} from './dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Flash Sales')
@Controller('flash-sale')
export class FlashSaleController {
  constructor(private readonly flashSaleService: FlashSaleService) {}

  // ✅ CREATE FLASH SALE (Vendor only)
  @UseGuards(AccessTokenGuard,RolesGuard)
  @Roles('vendor')
  @Post('create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new flash sale (Vendor only)' })
  @ApiResponse({ status: 201, description: 'Flash sale created successfully' })
  async createFlashSale(@Request() req, @Body() dto: CreateFlashSaleDto) {
    const vendorId = req.user.sub; // get from token
    const result = await this.flashSaleService.createFlashSale(vendorId, dto);
    return {
      success: true,
      message: 'Flash sale created successfully',
      data: result,
    };
  }

  // ✅ GET ALL FLASH SALES
  @Get()
  async getFlashSales(@Query() query: FlashSaleQueryDto) {
    const data = await this.flashSaleService.getFlashSales(query);
    return {
      success: true,
      message: 'Flash sales fetched successfully',
      data,
    };
  }

  // ✅ GET SINGLE FLASH SALE
  @Get(':id')
  async getFlashSaleById(@Param('id') id: string) {
    const data = await this.flashSaleService.getFlashSaleById(id);
    return { success: true, message: 'Flash sale fetched successfully', data };
  }

  // ✅ UPDATE FLASH SALE
  @UseGuards(AccessTokenGuard,RolesGuard)
  @Roles('vendor')
  @Patch(':id/update')
  @ApiBearerAuth()
  async updateFlashSale(@Param('id') id: string, @Body() dto: UpdateFlashSaleDto) {
    const result = await this.flashSaleService.updateFlashSale(id, dto);
    return { success: true, message: 'Flash sale updated successfully', data: result };
  }

  // ✅ PLACE BID
  @UseGuards(AccessTokenGuard,RolesGuard)
  @Roles('student')
  @Post('place-bid')
  @ApiBearerAuth()
  async placeBid(@Request() req, @Body() dto: PlaceBidDto) {
    const userId = req.user.sub;
    const result = await this.flashSaleService.placeBid(userId, dto);
    return { success: true, message: 'Bid placed successfully', data: result };
  }

  // ✅ CANCEL FLASH SALE
  @UseGuards(AccessTokenGuard,RolesGuard)
  @Roles('vendor')
  @Post('cancel')
  @ApiBearerAuth()
  async cancelFlashSale(@Request() req, @Body() dto: CancelFlashSaleDto) {
    const vendorId = req.user.sub;
    const result = await this.flashSaleService.cancelFlashSale(vendorId, dto);
    return { success: true, message: 'Flash sale cancelled successfully', data: result };
  }

  // ✅ COMPLETE FLASH SALE
  @UseGuards(AccessTokenGuard,RolesGuard)
  @Roles('vendor')
  @Post('complete')
  @ApiBearerAuth()
  async completeFlashSale(@Request() req, @Body() dto: CompleteFlashSaleDto) {
    const vendorId = req.user.sub;
    const result = await this.flashSaleService.completeFlashSale(vendorId, dto);
    return { success: true, message: 'Flash sale completed successfully', data: result };
  }
}
