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
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RateOrderDto } from './dto/rate-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { AcceptOrderDto } from './dto/accept-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { MarkDeliveredDto } from './dto/mark-delivered.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { SENSITIVE_THROTTLE } from 'src/common/throttle/throttle.config';

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
  async updateOrder(@Request() req, @Param('id') id: string, @Body() dto: UpdateOrderDto) {
    const data = await this.ordersService.updateOrder(id, req.user.sub, dto);
    return { success: true, message: 'Order updated successfully', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('vendor')
  @Patch(':id/status')
  @ApiBearerAuth()
  async updateOrderStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const data = await this.ordersService.updateOrderStatus(id, req.user.sub, dto.status);
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
  @Post(':id/dispute')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report a problem with a delivered order; the payment stays held until an admin resolves it' })
  async openDispute(@Request() req, @Param('id') id: string, @Body() dto: OpenDisputeDto) {
    const data = await this.ordersService.openDispute(id, req.user.sub, dto);
    return { success: true, message: 'Dispute submitted for review', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  @Patch(':id/dispute/resolve')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolve a dispute by refunding the customer or releasing the payment to the vendor' })
  async resolveDispute(@Request() req, @Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    const data = await this.ordersService.resolveDispute(id, req.user.sub, dto);
    return { success: true, message: `Dispute resolved: ${dto.resolution}`, data };
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
  @Roles('vendor')
  @Patch(':id/accept')
  @ApiBearerAuth()
  async acceptOrder(@Request() req, @Param('id') id: string, @Body() dto: AcceptOrderDto) {
    const data = await this.ordersService.acceptOrder(id, req.user.sub, dto);
    return { success: true, message: 'Order accepted successfully', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('vendor')
  @Patch(':id/reject')
  @ApiBearerAuth()
  async rejectOrder(@Request() req, @Param('id') id: string, @Body() dto: RejectOrderDto) {
    const data = await this.ordersService.rejectOrder(id, req.user.sub, dto);
    return { success: true, message: 'Order rejected successfully', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('vendor')
  @Patch(':id/mark-delivered')
  @Throttle(SENSITIVE_THROTTLE)
  @ApiBearerAuth()
  async markDelivered(@Request() req, @Param('id') id: string, @Body() dto: MarkDeliveredDto) {
    const data = await this.ordersService.markDelivered(id, req.user.sub, dto.deliveryCode);
    return { success: true, message: 'Order marked as delivered', data };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('student')
  @Post(':id/confirm-delivery')
  @Throttle(SENSITIVE_THROTTLE)
  @ApiBearerAuth()
  async confirmDelivery(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ConfirmDeliveryDto,
  ) {
    const data = await this.ordersService.confirmDelivery(id, req.user.sub, dto);
    return { success: true, message: 'Delivery confirmed successfully', data };
  }

  @UseGuards(AccessTokenGuard)
  @Get(':id/track')
  @ApiBearerAuth()
  async trackOrder(@Request() req, @Param('id') id: string) {
    const data = await this.ordersService.trackOrder(id, req.user.sub, req.user.role);
    return { success: true, message: 'Order tracking info fetched successfully', data };
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
