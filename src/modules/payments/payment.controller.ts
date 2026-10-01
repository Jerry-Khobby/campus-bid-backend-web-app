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
import { PayoutsService } from './payouts.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { SubmitMomoOtpDto } from './dto/submit-momo-otp.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { RejectPayoutDto } from './dto/reject-payout.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payoutsService: PayoutsService,
  ) {}

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
  // SUBMIT MOBILE MONEY OTP (student)
  // ----------------------------
  @Roles('student')
  @Post(':id/submit-otp')
  @ApiOperation({ summary: 'Submit the OTP for a pending mobile money charge (student)' })
  async submitOtp(@Param('id') id: string, @Body() dto: SubmitMomoOtpDto, @Req() req) {
    return this.paymentsService.submitMomoOtp(id, dto.otp, req.user.sub);
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
  // LIST PAYOUT REQUESTS (admin)
  // ----------------------------
  @Roles('admin')
  @Get('payouts')
  @ApiOperation({ summary: 'List vendor payout requests, optionally filtered by status (admin)' })
  async listPayouts(@Query('status') status?: string) {
    return this.payoutsService.listAllPayouts(status);
  }

  // ----------------------------
  // APPROVE PAYOUT (admin) - sends the real Paystack transfer
  // ----------------------------
  @Roles('admin')
  @Patch('payouts/:id/approve')
  @ApiOperation({ summary: 'Approve a payout request and send the mobile money transfer (admin)' })
  async approvePayout(@Param('id') id: string, @Req() req) {
    return this.payoutsService.approvePayout(id, req.user.sub);
  }

  // ----------------------------
  // REJECT PAYOUT (admin)
  // ----------------------------
  @Roles('admin')
  @Patch('payouts/:id/reject')
  @ApiOperation({ summary: 'Reject a payout request without sending a transfer (admin)' })
  async rejectPayout(@Param('id') id: string, @Body() dto: RejectPayoutDto, @Req() req) {
    return this.payoutsService.rejectPayout(id, req.user.sub, dto.reason);
  }

  // ----------------------------
  // GET ONE (admin/student/vendor)
  // ----------------------------
  @Roles('admin', 'student', 'vendor')
  @Get(':id')
  @ApiOperation({ summary: 'Get a payment by ID (its customer, its vendor or an admin)' })
  async findOne(@Param('id') id: string, @Req() req) {
    return this.paymentsService.getPaymentForActor(id, req.user);
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
  // REFUND PAYMENT (student) - only for an already cancelled order
  // ----------------------------
  @Roles('student')
  @Put(':id/refund')
  @ApiOperation({ summary: 'Refund the held payment of a cancelled order (student)' })
  async refund(@Param('id') id: string, @Body() dto: RefundPaymentDto, @Req() req) {
    return this.paymentsService.refundPaymentForCancelledOrder(id, dto, req.user.sub);
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
