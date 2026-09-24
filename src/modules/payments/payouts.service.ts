import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
// NOTE: Payment.vendorId/customerId are real ObjectIds in the schema (see
// payment.schema.ts). A plain .find()/.findById()/.countDocuments() call
// auto-casts a string vendorId against that schema, so passing it as-is
// there is correct and required. Aggregation $match stages are raw MongoDB
// pipelines and do NOT apply that casting — any vendorId used inside an
// aggregate() must be wrapped in `new Types.ObjectId(vendorId)` first, or it
// silently matches nothing.
import { Payment, PaymentDocument } from './schema/payment.schema';
import { Payout, PayoutDocument } from './schema/payout.schema';
import { Vendor, VendorDocument } from '../vendors/schema/vendor.schema';

interface VendorBalances {
  pendingBalance: number;
  availableBalance: number;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Payout.name)
    private readonly payoutModel: Model<PayoutDocument>,
    @InjectModel(Vendor.name)
    private readonly vendorModel: Model<VendorDocument>,
  ) {}

  // -----------------------------
  // VENDOR BALANCES (public contract — consumed by the vendor dashboard module)
  // -----------------------------
  async getVendorBalances(vendorId: string): Promise<VendorBalances> {
    const vendorObjectId = new Types.ObjectId(vendorId);
    const [pendingBalance, availableBalance] = await Promise.all([
      this.sumPaymentsAmount({ vendorId: vendorObjectId, status: 'held' }, '$amount'),
      this.sumPaymentsAmount({ vendorId: vendorObjectId, status: 'released', payoutId: null }, '$vendorPayout'),
    ]);

    return { pendingBalance, availableBalance };
  }

  private async sumPaymentsAmount(match: Record<string, unknown>, field: string): Promise<number> {
    const [result] = await this.paymentModel.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: field } } },
    ]);

    return result?.total ?? 0;
  }

  // -----------------------------
  // HELD PAYMENTS (itemized pending balance)
  // -----------------------------
  async getHeldPayments(vendorId: string): Promise<{ payments: PaymentDocument[]; totalHeld: number }> {
    const payments = await this.paymentModel
      .find({ vendorId, status: 'held' })
      .sort({ createdAt: -1 })
      .populate('orderId', 'orderNumber');

    const totalHeld = payments.reduce((sum, payment) => sum + payment.amount, 0);

    return { payments, totalHeld };
  }

  // -----------------------------
  // REQUEST PAYOUT (vendor)
  // -----------------------------
  async requestPayout(vendorId: string): Promise<PayoutDocument> {
    const releasedPayments = await this.paymentModel.find({
      vendorId,
      status: 'released',
      payoutId: null,
    });

    if (releasedPayments.length === 0)
      throw new BadRequestException('No available balance to pay out');

    const vendor = await this.findVendor(vendorId);
    const amount = releasedPayments.reduce((sum, payment) => sum + payment.vendorPayout, 0);
    const paymentIds = releasedPayments.map((payment) => payment._id as Types.ObjectId);

    const payout = await this.payoutModel.create({
      vendorId,
      amount,
      paymentIds,
      bankSnapshot: vendor.bankDetails,
    });

    await this.claimPaymentsForPayout(paymentIds, payout._id as Types.ObjectId);

    this.logger.log(`Payout ${payout._id} requested by vendor ${vendorId} for amount ${amount}`);

    return payout;
  }

  private async findVendor(vendorId: string): Promise<VendorDocument> {
    const vendor = await this.vendorModel.findById(vendorId);
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  // Re-checks payoutId:null in the filter to guard against a race between two
  // concurrent payout requests claiming the same released payments.
  private async claimPaymentsForPayout(
    paymentIds: Types.ObjectId[],
    payoutId: Types.ObjectId,
  ): Promise<void> {
    await this.paymentModel.updateMany(
      { _id: { $in: paymentIds }, payoutId: null },
      { payoutId },
    );
  }

  // -----------------------------
  // LIST PAYOUTS (vendor)
  // -----------------------------
  async listPayouts(vendorId: string): Promise<PayoutDocument[]> {
    return this.payoutModel.find({ vendorId }).sort({ createdAt: -1 });
  }
}
