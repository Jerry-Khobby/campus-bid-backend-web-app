import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaystackService } from './paystack.service';

const PESEWAS_PER_CEDI = 100;
const DUPLICATE_KEY_ERROR_CODE = 11000;
const PAYOUT_AWAITING_APPROVAL = 'requested';
// 'processing' counts as open too: a failed transfer reverts its payout to
// 'requested', which must not collide with a newer request.
const OPEN_PAYOUT_STATUSES = [PAYOUT_AWAITING_APPROVAL, 'processing'];
const DUPLICATE_PAYOUT_MESSAGE = 'You already have a payout request in progress';
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
    private readonly paystackService: PaystackService,
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
    const vendor = await this.findVendor(vendorId);
    await this.assertNoOpenPayout(vendorId);

    const payout = await this.createEmptyPayout(vendorId, vendor);

    try {
      return await this.fundPayoutFromClaimedPayments(payout);
    } catch (error) {
      await this.discardPayout(payout._id as Types.ObjectId);
      throw error;
    }
  }

  private async findVendor(vendorId: string): Promise<VendorDocument> {
    const vendor = await this.vendorModel.findById(vendorId);
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  private async assertNoOpenPayout(vendorId: string): Promise<void> {
    const openPayout = await this.payoutModel.exists({ vendorId, status: { $in: OPEN_PAYOUT_STATUSES } });
    if (openPayout) throw new ConflictException(DUPLICATE_PAYOUT_MESSAGE);
  }

  // The partial unique index on (vendorId, status: 'requested') turns a
  // concurrent second request into a duplicate-key error right here, before
  // it can claim anything.
  private async createEmptyPayout(vendorId: string, vendor: VendorDocument): Promise<PayoutDocument> {
    try {
      return await this.payoutModel.create({
        vendorId,
        amount: 0,
        paymentIds: [],
        bankSnapshot: vendor.bankDetails,
      });
    } catch (error) {
      if (error?.code === DUPLICATE_KEY_ERROR_CODE) throw new ConflictException(DUPLICATE_PAYOUT_MESSAGE);
      throw error;
    }
  }

  // Claim first, then sum: the payout's own _id is the unique claim token, so
  // the amount only ever covers payments this request actually tagged.
  private async fundPayoutFromClaimedPayments(payout: PayoutDocument): Promise<PayoutDocument> {
    const payoutId = payout._id as Types.ObjectId;
    await this.claimReleasedPayments(payout.vendorId, payoutId);

    const claimedPayments = await this.paymentModel.find({ payoutId });
    if (claimedPayments.length === 0) throw new BadRequestException('No available balance to pay out');

    payout.amount = claimedPayments.reduce((sum, payment) => sum + payment.vendorPayout, 0);
    payout.paymentIds = claimedPayments.map((payment) => payment._id as Types.ObjectId);
    await payout.save();

    this.logger.log(`Payout ${payoutId} requested by vendor ${payout.vendorId} for amount ${payout.amount}`);
    return payout;
  }

  private async claimReleasedPayments(vendorId: Types.ObjectId, payoutId: Types.ObjectId): Promise<void> {
    await this.paymentModel.updateMany(
      { vendorId, status: 'released', payoutId: null },
      { payoutId },
    );
  }

  private async discardPayout(payoutId: Types.ObjectId): Promise<void> {
    await this.paymentModel.updateMany({ payoutId }, { payoutId: null });
    await this.payoutModel.deleteOne({ _id: payoutId });
  }

  // -----------------------------
  // LIST PAYOUTS (vendor)
  // -----------------------------
  async listPayouts(vendorId: string): Promise<PayoutDocument[]> {
    return this.payoutModel.find({ vendorId }).sort({ createdAt: -1 });
  }

  // -----------------------------
  // LIST PAYOUTS (admin)
  // -----------------------------
  async listAllPayouts(status?: string): Promise<PayoutDocument[]> {
    const filter = status ? { status } : {};
    const payouts = await this.payoutModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('vendorId', 'email profile.businessName bankDetails');

    // Self-heal any payout still waiting on Paystack to confirm, the same way
    // payments reconcile themselves on read rather than relying solely on
    // the transfer webhook arriving.
    await Promise.all(
      payouts
        .filter((payout) => payout.status === 'processing')
        .map((payout) =>
          this.reconcilePayout(payout).catch((error) =>
            this.logger.error(
              `Paystack reconciliation failed for payout ${payout._id} (ref ${payout.transferReference}); it stays 'processing': ${error.message}`,
              error.stack,
            ),
          ),
        ),
    );

    return payouts;
  }

  // -----------------------------
  // APPROVE PAYOUT (admin) - actually sends the money via Paystack Transfer
  // -----------------------------
  async approvePayout(payoutId: string, adminId: string): Promise<PayoutDocument> {
    const payout = await this.claimPayoutForProcessing(payoutId);

    try {
      const vendor = await this.findVendor(payout.vendorId.toString());
      this.assertPayoutDestinationReady(vendor);

      const recipient = await this.paystackService.createTransferRecipient(
        vendor.bankDetails.accountName!,
        vendor.bankDetails.accountNumber!,
        vendor.bankDetails.momoProvider!,
      );
      payout.recipientCode = recipient.recipient_code;

      const transfer = await this.paystackService.initiateTransfer(
        recipient.recipient_code,
        this.toSmallestCurrencyUnit(payout.amount),
        payout.transferReference!,
        `CampusBid payout ${(payout._id as Types.ObjectId).toString()}`,
      );

      payout.transferCode = transfer.transfer_code;
      payout.gatewayResponse = transfer;
      payout.approvedBy = new Types.ObjectId(adminId);

      // Test-mode (and occasionally live) transfers can resolve immediately;
      // otherwise it stays 'processing' until the webhook or the next admin
      // list-read reconciles it against Paystack's real status.
      if (transfer.status === 'success') {
        payout.status = 'completed';
        payout.completedAt = new Date();
      }

      await payout.save();
      this.logger.log(`Payout ${payout._id} approved by admin ${adminId}, transfer status: ${transfer.status}`);
      return payout;
    } catch (error) {
      // Revert the claim so the admin can fix the problem (e.g. missing momo
      // details) and retry - the stable transferReference is kept as-is.
      payout.status = 'requested';
      payout.failureReason = error instanceof Error ? error.message : 'Transfer failed';
      await payout.save();
      throw error;
    }
  }

  // Atomically claims a 'requested' payout for processing, guarding against
  // double-approval from a duplicate click or a concurrent admin action.
  // Generates the payout's transferReference on first claim and keeps it
  // stable across any retry after a failed attempt reverts the status.
  private async claimPayoutForProcessing(payoutId: string): Promise<PayoutDocument> {
    if (!Types.ObjectId.isValid(payoutId)) throw new BadRequestException('Invalid payoutId');

    const existing = await this.payoutModel.findById(payoutId);
    if (!existing) throw new NotFoundException('Payout not found');

    const transferReference = existing.transferReference ?? `payout_${payoutId}_${Date.now()}`;

    const payout = await this.payoutModel.findOneAndUpdate(
      { _id: payoutId, status: PAYOUT_AWAITING_APPROVAL, amount: { $gt: 0 } },
      { status: 'processing', transferReference },
      { new: true },
    );

    if (!payout) throw new ConflictException('Payout has already been processed or is not awaiting approval');
    return payout;
  }

  private assertPayoutDestinationReady(vendor: VendorDocument): void {
    const { accountName, accountNumber, momoProvider } = vendor.bankDetails ?? {};
    if (!accountName || !accountNumber || !momoProvider) {
      throw new BadRequestException('Vendor has not set up mobile money payout details');
    }
  }

  private toSmallestCurrencyUnit(amountInCedis: number): number {
    return Math.round(amountInCedis * PESEWAS_PER_CEDI);
  }

  // -----------------------------
  // REJECT PAYOUT (admin) - declines without ever calling Paystack
  // -----------------------------
  async rejectPayout(payoutId: string, adminId: string, reason: string): Promise<PayoutDocument> {
    const payout = await this.payoutModel.findOneAndUpdate(
      { _id: payoutId, status: 'requested' },
      { status: 'failed', failureReason: reason, approvedBy: new Types.ObjectId(adminId) },
      { new: true },
    );

    if (!payout) throw new ConflictException('Payout has already been processed or is not awaiting approval');

    await this.releasePaymentsFromPayout(payout.paymentIds, payout._id as Types.ObjectId);
    this.logger.log(`Payout ${payout._id} rejected by admin ${adminId}: ${reason}`);
    return payout;
  }

  private async releasePaymentsFromPayout(
    paymentIds: Types.ObjectId[],
    payoutId: Types.ObjectId,
  ): Promise<void> {
    await this.paymentModel.updateMany({ _id: { $in: paymentIds }, payoutId }, { payoutId: null });
  }

  // Independently asks Paystack for a transfer's real status, same
  // self-healing approach already used for payments - a webhook is a
  // courtesy notification, not the only way this ever gets confirmed.
  private async reconcilePayout(payout: PayoutDocument): Promise<void> {
    if (payout.status !== 'processing' || !payout.transferReference) return;

    const verified = await this.paystackService.verifyTransfer(payout.transferReference);

    if (verified.status === 'success') {
      payout.status = 'completed';
      payout.completedAt = new Date();
      payout.gatewayResponse = verified;
      await payout.save();
      return;
    }

    if (['failed', 'reversed'].includes(verified.status)) {
      payout.status = 'failed';
      payout.failureReason = `Paystack transfer ${verified.status}`;
      payout.gatewayResponse = verified;
      await payout.save();
      await this.releasePaymentsFromPayout(payout.paymentIds, payout._id as Types.ObjectId);
    }
  }

  // -----------------------------
  // PAYSTACK TRANSFER WEBHOOK
  // -----------------------------
  async reconcilePayoutByReference(reference: string): Promise<void> {
    const payout = await this.payoutModel.findOne({ transferReference: reference });
    if (!payout) {
      this.logger.warn(`Transfer webhook received for unknown reference ${reference}`);
      return;
    }

    await this.reconcilePayout(payout);
  }
}
