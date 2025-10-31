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
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RateOrderDto } from './dto/rate-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('student')
  @Post('create')
  @ApiBearerAuth()
  async createOrder(@Request() req, @Body() dto: CreateOrderDto) {
    const customerId = req.user.sub;
    const data = await this.ordersService.createOrder(customerId, dto);
    return { success: true, message: 'Order created successfully', data };
  }

  @UseGuards(AccessTokenGuard)
  @Get()
  @ApiBearerAuth()
  async getOrders(@Request() req, @Query() query: OrderQueryDto) {
    const data = await this.ordersService.getOrders(req.user.sub, req.user.role, query);
    return { success: true, message: 'Orders fetched successfully', data };
  }

  @UseGuards(AccessTokenGuard)
  @Get(':id')
  @ApiBearerAuth()
  async getOrderById(@Request() req, @Param('id') id: string) {
    const data = await this.ordersService.getOrderById(id, req.user.sub, req.user.role);
    return { success: true, message: 'Order fetched successfully', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('vendor')
  @Patch(':id/update')
  @ApiBearerAuth()
  async updateOrder(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    const data = await this.ordersService.updateOrder(id, dto);
    return { success: true, message: 'Order updated successfully', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('vendor')
  @Patch(':id/status')
  @ApiBearerAuth()
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const data = await this.ordersService.updateOrderStatus(id, dto.status);
    return { success: true, message: `Order status updated to ${dto.status}`, data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('student')
  @Post(':id/cancel')
  @ApiBearerAuth()
  async cancelOrder(@Request() req, @Param('id') id: string, @Body() dto: CancelOrderDto) {
    const data = await this.ordersService.cancelOrder(id, req.user.sub, dto);
    return { success: true, message: 'Order cancelled successfully', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('student')
  @Post(':id/rate')
  @ApiBearerAuth()
  async rateOrder(@Request() req, @Param('id') id: string, @Body() dto: RateOrderDto) {
    const data = await this.ordersService.rateOrder(id, req.user.sub, dto);
    return { success: true, message: 'Order rated successfully', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Post('auto-complete')
  @ApiBearerAuth()
  async autoCompleteOrders() {
    const count = await this.ordersService.autoCompleteDeliveredOrders();
    return { success: true, message: `${count} orders auto-completed` };
  }
}
