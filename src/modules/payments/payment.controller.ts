import {
  Controller,
  Post,
  Get,
  Patch,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payment.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ----------------------------
  // INITIALIZE PAYMENT (student)
  // ----------------------------
  @Roles('student')
  @Post('initialize')
  @ApiOperation({ summary: 'Initialize a Paystack payment for an order (student)' })
  async initialize(@Req() req, @Body() dto: InitializePaymentDto) {
    return this.paymentsService.initializePayment(req.user.sub, dto, req.user.email);
  }

  // ----------------------------
  // LIST PAYMENTS (admin)
  // ----------------------------
  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'List all payments (admin only)' })
  async findAll(@Query() query: PaymentQueryDto) {
    return this.paymentsService.listPayments(query);
  }

  // ----------------------------
  // PAYMENT HISTORY (any authenticated role)
  // ----------------------------
  @Get('history')
  @ApiOperation({ summary: 'List payments for the authenticated user' })
  async history(@Req() req) {
    return this.paymentsService.getPaymentHistory(req.user.sub, req.user.role);
  }

  // ----------------------------
  // GET ONE (admin/student/vendor)
  // ----------------------------
  @Roles('admin', 'student', 'vendor')
  @Get(':id')
  @ApiOperation({ summary: 'Get a payment by ID' })
  async findOne(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  // ----------------------------
  // UPDATE PAYMENT (admin)
  // ----------------------------
  @Roles('admin')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a payment record (admin)' })
  async update(@Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    return this.paymentsService.updatePayment(id, dto);
  }

  // ----------------------------
  // RELEASE PAYMENT (student)
  // ----------------------------
  @Roles('student')
  @Patch(':id/release')
  @ApiOperation({ summary: 'Release held payment (student confirms delivery)' })
  async release(@Param('id') id: string, @Req() req) {
    return this.paymentsService.releasePayment(id, req.user.sub);
  }

  // ----------------------------
  // REFUND PAYMENT (student)
  // ----------------------------
  @Roles('student')
  @Put(':id/refund')
  @ApiOperation({ summary: 'Refund held payment (student disputes)' })
  async refund(@Param('id') id: string, @Body() dto: RefundPaymentDto, @Req() req) {
    return this.paymentsService.refundPayment(id, dto, req.user.sub);
  }

  // ----------------------------
  // UPDATE STATUS (admin)
  // ----------------------------
  @Roles('admin')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Update payment status (admin)' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdatePaymentStatusDto) {
    return this.paymentsService.updatePaymentStatus(id, dto);
  }
}
