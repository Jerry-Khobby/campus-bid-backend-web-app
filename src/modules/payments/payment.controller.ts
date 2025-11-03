import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PaymentsService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
// import { AuthGuard } from '../auth/auth.guard'; // assuming you have one

@ApiTags('Payments')
// @UseGuards(AuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a payment (status: held)' })
  async create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.createPayment(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payments (filterable)' })
  async findAll(@Query() query: PaymentQueryDto) {
    return this.paymentsService.listPayments(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment by ID' })
  async findOne(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a payment record' })
  async update(@Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    return this.paymentsService.updatePayment(id, dto);
  }

  @Patch(':id/release')
  @ApiOperation({ summary: 'Release held payment (customer confirms delivery)' })
  async release(@Param('id') id: string, @Req() req: any) {
    // const actorId = req.user._id; // assuming JWT user
    const actorId = req.user?.id || 'mockUser'; // mock fallback for now
    return this.paymentsService.releasePayment(id, actorId);
  }

  @Post('refund')
  @ApiOperation({ summary: 'Refund held payment (customer disputes)' })
  async refund(@Body() dto: RefundPaymentDto, @Req() req: any) {
    const actorId = req.user?.id || 'mockUser';
    return this.paymentsService.refundPayment(dto, actorId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update payment status (admin)' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdatePaymentStatusDto) {
    return this.paymentsService.updatePaymentStatus(id, dto);
  }
}
