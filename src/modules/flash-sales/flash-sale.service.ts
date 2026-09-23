import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
  Inject,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
  CreateFlashSaleDto,
  UpdateFlashSaleDto,
  PlaceBidDto,
  CancelFlashSaleDto,
  CompleteFlashSaleDto,
  FlashSaleQueryDto,
  VendorFlashSaleQueryDto,
  BidStatus,
  FlashSaleStatus,
  FlashSaleReason,
} from './dto';
import { FlashSale, FlashSaleDocument } from './schema/flash-sale.schema';
import {Cron,CronExpression} from "@nestjs/schedule";
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FlashSaleService {
  private readonly logger = new Logger(FlashSaleService.name);

  constructor(
    @InjectModel(FlashSale.name)
    private readonly flashSaleModel: Model<FlashSaleDocument>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly notificationsService: NotificationsService,
  ) {}


  /// the cron job will come later 

// @Cron('*/30 * * * * *') // every 30 seconds
// async autoStartFlashSalesJob() {
//   await this.autoStartFlashSales();
// }

// @Cron('0 */4 * * * *') // every minute
// async autoEndFlashSalesJob() {
//   await this.autoEndExpiredSales();
// }

  // -----------------------
  // CREATE FLASH SALE
  // -----------------------
  async createFlashSale(vendorId:string,dto: CreateFlashSaleDto): Promise<FlashSaleDocument> {
    try {
      const flashSale = new this.flashSaleModel({
        ...dto,
        vendorId,
        status: FlashSaleStatus.UPCOMING,
      });

      const saved = await flashSale.save();
      await this.cacheManager.set(`flash-sale:${saved._id}`, saved, 600_000);

      this.logger.log(`✅ Flash sale created for product: ${dto.productId}`);
      return saved;
    } catch (error) {
      this.logger.error('❌ Error creating flash sale', error);
      throw new InternalServerErrorException('Failed to create flash sale');
    }
  }

  // -----------------------
  // GET FLASH SALES WITH FILTER + CACHE
  // -----------------------
  async getFlashSales(query: FlashSaleQueryDto): Promise<FlashSaleDocument[]> {
    const cacheKey = `flash-sales:${JSON.stringify(query)}`;
    const cached = await this.cacheManager.get<FlashSaleDocument[]>(cacheKey);
    if (cached) {
      this.logger.log(`💾 Returning cached flash sales`);
      return cached;
    }

    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.vendorId) filter.vendorId = query.vendorId;
    if (query.productId) filter.productId = query.productId;
    if (query.startAfter) filter.startTime = { $gte: query.startAfter };
    if (query.endBefore) filter.endTime = { $lte: query.endBefore };
    if (query.minBid) filter.currentBid = { $gte: query.minBid };
    if (query.maxBid) filter.currentBid = { ...filter.currentBid, $lte: query.maxBid };

    const sales = await this.flashSaleModel
      .find(filter)
      .populate('vendorId productId currentBidder winner', '-password')
      .exec();

    await this.cacheManager.set(cacheKey, sales, 300_000);
    return sales;
  }

  // -----------------------
  // GET FLASH SALE BY ID (CACHE FIRST)
  // -----------------------
  async getFlashSaleById(id: string): Promise<FlashSaleDocument> {
    const cacheKey = `flash-sale:${id}`;
    const cached = await this.cacheManager.get<FlashSaleDocument>(cacheKey);
    if (cached) return cached;

    const sale = await this.flashSaleModel
      .findById(id)
      .populate('vendorId productId currentBidder winner', '-password')
      .exec();

    if (!sale) throw new NotFoundException('Flash sale not found');

    await this.cacheManager.set(cacheKey, sale, 300_000);
    return sale;
  }

  // -----------------------
  // UPDATE FLASH SALE
  // -----------------------
  async updateFlashSale(id: string, dto: UpdateFlashSaleDto): Promise<FlashSaleDocument> {
    const sale = await this.flashSaleModel.findById(id);
    if (!sale) throw new NotFoundException('Flash sale not found');

    Object.assign(sale, dto);
    const updated = await sale.save();

    await this.cacheManager.set(`flash-sale:${id}`, updated, 600_000);
    this.logger.log(`🔄 Flash sale updated: ${id}`);

    return updated;
  }

  // -----------------------
  // PLACE BID (Atomic with Cache)
  // -----------------------
  async placeBid(flashSaleId: string, userId: string, dto: PlaceBidDto): Promise<FlashSaleDocument> {
    const lockKey = `lock:flash-sale:${flashSaleId}`;
    await this.acquireBidLock(lockKey);

    try {
      const sale = this.getSaleOrThrow(
        await this.flashSaleModel.findById(flashSaleId).populate('productId', 'name'),
      );
      this.assertSaleIsActive(sale);
      this.assertBidMeetsMinimum(sale, dto.amount);

      const previousBidder = sale.currentBidder;
      const previousBid = sale.currentBid;
      this.applyBid(sale, userId, dto.amount);

      const updated = await sale.save();
      await this.cacheManager.set(`flash-sale:${flashSaleId}`, updated, 600_000);
      await this.notifyOutbidUser(sale, previousBidder, previousBid, userId, dto.amount);

      this.logger.log(`💰 New bid placed: ${dto.amount} by ${userId} on ${flashSaleId}`);
      return updated;
    } finally {
      await this.cacheManager.del(lockKey);
    }
  }

  private async acquireBidLock(lockKey: string) {
    const cachedLock = await this.cacheManager.get(lockKey);
    if (cachedLock) throw new ForbiddenException('Bid is being processed, try again shortly');
    await this.cacheManager.set(lockKey, 'locked', 5_000);
  }

  private assertSaleIsActive(sale: FlashSaleDocument) {
    if (sale.status !== FlashSaleStatus.ACTIVE)
      throw new BadRequestException('Bidding is only allowed on active flash sales');
  }

  private assertBidMeetsMinimum(sale: FlashSaleDocument, amount: number) {
    const minAllowed = (sale.currentBid || sale.startingBid) + (sale.minimumBidIncrement || 1);
    if (amount < minAllowed) throw new BadRequestException(`Bid must be at least ${minAllowed}`);
  }

  private applyBid(sale: FlashSaleDocument, userId: string, amount: number) {
    sale.currentBid = amount;
    sale.currentBidder = new Types.ObjectId(userId);
    sale.bids.push({ userId: new Types.ObjectId(userId), amount, timestamp: new Date() });
  }

  private async notifyOutbidUser(
    sale: FlashSaleDocument,
    previousBidder: Types.ObjectId | undefined,
    previousBid: number | undefined,
    newBidderId: string,
    newAmount: number,
  ) {
    if (!previousBidder || previousBidder.toString() === newBidderId) return;

    const saleId = (sale._id as Types.ObjectId).toString();
    const productName = (sale.productId as any)?.name || saleId;
    try {
      await this.notificationsService.notify(
        previousBidder.toString(),
        'customer',
        'flash_sale_alert',
        'Outbid!',
        `You've been outbid on ${productName}`,
        { flashSaleId: saleId, currentBid: newAmount, yourBid: previousBid },
      );
    } catch (error) {
      this.logger.error('Failed to send outbid notification', error);
    }
  }

  // -----------------------
  // CANCEL FLASH SALE
  // -----------------------
  async cancelFlashSale(flashSaleId: string, vendorId: string, dto: CancelFlashSaleDto) {
    const sale = this.getSaleOrThrow(await this.flashSaleModel.findById(flashSaleId));
    this.assertVendorOwnsSale(sale, vendorId, 'cancel');

    if (sale.status === FlashSaleStatus.COMPLETED)
      throw new ConflictException('Cannot cancel a completed flash sale');

    sale.status = FlashSaleStatus.CANCELLED;
    sale.reason = dto.reason;
    const updated = await sale.save();
    await this.cacheManager.set(`flash-sale:${flashSaleId}`, updated, 300_000);
    return updated;
  }

  // -----------------------
  // COMPLETE FLASH SALE
  // -----------------------
  async completeFlashSale(vendorId: string, dto: CompleteFlashSaleDto) {
    const sale = this.getSaleOrThrow(
      await this.flashSaleModel.findById(dto.flashSaleId).populate('productId', 'name'),
    );
    this.assertVendorOwnsSale(sale, vendorId, 'complete');

    if (sale.status === FlashSaleStatus.COMPLETED)
      throw new ConflictException('Flash sale already completed');

    sale.status = FlashSaleStatus.COMPLETED;
    sale.winner = dto.winner;
    sale.currentBid = dto.finalBid;
    sale.reason = FlashSaleReason.CLOSING_TIME;

    const updated = await sale.save();
    await this.cacheManager.set(`flash-sale:${dto.flashSaleId}`, updated, 300_000);
    await this.notifyWinner(updated);
    return updated;
  }

  private async notifyWinner(sale: FlashSaleDocument) {
    if (!sale.winner) return;

    try {
      await this.notificationsService.notify(
        sale.winner.toString(),
        'customer',
        'flash_sale_won',
        'You won!',
        'Congratulations! You won the flash sale',
        { flashSaleId: (sale._id as Types.ObjectId).toString(), winningBid: sale.currentBid },
      );
    } catch (error) {
      this.logger.error('Failed to send flash sale win notification', error);
    }
  }

  // -----------------------
  // MY BIDS (Student)
  // -----------------------
  async getMyBids(userId: string, status?: BidStatus) {
    const sales = await this.flashSaleModel
      .find({ 'bids.userId': new Types.ObjectId(userId) })
      .populate('vendorId productId', '-password')
      .sort({ createdAt: -1 })
      .exec();

    const classified = sales.map((sale) => ({
      ...sale.toObject(),
      bidStatus: this.resolveBidStatus(sale, userId),
    }));

    return status ? classified.filter((entry) => entry.bidStatus === status) : classified;
  }

  private resolveBidStatus(sale: FlashSaleDocument, userId: string): BidStatus {
    if (sale.status === FlashSaleStatus.ACTIVE) return 'active';
    if (sale.status === FlashSaleStatus.COMPLETED && sale.winner?.toString() === userId) return 'won';
    return 'lost';
  }

  // -----------------------
  // VENDOR FLASH SALES (used by the vendors module)
  // -----------------------
  async getVendorFlashSales(vendorId: string, query: VendorFlashSaleQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 10);
    const skip = (page - 1) * limit;
    const filter = { vendorId, ...(query.status && { status: query.status }) };

    const [items, total] = await Promise.all([
      this.flashSaleModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('productId', 'name images')
        .exec(),
      this.flashSaleModel.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }

  private getSaleOrThrow(sale: FlashSaleDocument | null): FlashSaleDocument {
    if (!sale) throw new NotFoundException('Flash sale not found');
    return sale;
  }

  private assertVendorOwnsSale(sale: FlashSaleDocument, vendorId: string, action: string) {
    if (sale.vendorId.toString() !== vendorId)
      throw new ForbiddenException(`You are not authorized to ${action} this flash sale`);
  }


///--------------------------
// AUTO-START UPCOMING SALES 
///


  async autoStartFlashSales(): Promise<number> {
    const now = new Date();
    const upcoming = await this.flashSaleModel.find({
      status: FlashSaleStatus.UPCOMING,
      startTime: { $lte: now },
    });

    let count = 0;
    for (const sale of upcoming) {
      sale.status = FlashSaleStatus.ACTIVE;
      await sale.save();
      await this.cacheManager.set(`flash-sale:${sale._id}`, sale, 300_000);
      count++;
    }

    if (count > 0) this.logger.log(`🚀 Activated ${count} flash sales`);
    return count;
  }


  // -----------------------
  // AUTO-END EXPIRED SALES (cronjob hook)
  // -----------------------
  async autoEndExpiredSales(): Promise<number> {
    const now = new Date();
    const expired = await this.flashSaleModel.find({
      status: FlashSaleStatus.ACTIVE,
      endTime: { $lte: now },
    });

    let count = 0;
    for (const sale of expired) {
      sale.status = FlashSaleStatus.COMPLETED;
      sale.reason = FlashSaleReason.CLOSING_TIME;
      await sale.save();
      await this.cacheManager.set(`flash-sale:${sale._id}`, sale, 300_000);
      count++;
    }

    if (count > 0) this.logger.log(`🕒 Auto-ended ${count} expired flash sales`);
    return count;
  }


}
