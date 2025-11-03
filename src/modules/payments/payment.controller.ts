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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
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
  // CREATE PAYMENT (student)
  // ----------------------------
  @Roles('student')
  @Post()
  @ApiOperation({ summary: 'Create a payment (student)' })
  async create(@Req() req, @Body() dto: CreatePaymentDto) {
    const customerId = req.user.sub;
    return this.paymentsService.createPayment({ ...dto, customerId });
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
  // GET ONE (admin/student/vendor)
  // ----------------------------
  @Roles('admin', 'student', 'vendor')
  @Get(':id')
  @ApiOperation({ summary: 'Get a payment by ID' })
  async findOne(@Param('id') id: string, @Req() req) {
    const actor = req.user;
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
    const actorId = req.user.sub;
    return this.paymentsService.releasePayment(id, actorId);
  }

  // ----------------------------
  // REFUND PAYMENT (student)
  // ----------------------------
  @Roles('student')
  @Post('refund')
  @ApiOperation({ summary: 'Refund held payment (student disputes)' })
  async refund(@Body() dto: RefundPaymentDto, @Req() req) {
    const actorId = req.user.sub;
    return this.paymentsService.refundPayment(dto, actorId);
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
