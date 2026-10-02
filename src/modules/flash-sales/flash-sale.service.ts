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
import { FilterQuery, Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ProductsService } from '../products/products.service';
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
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service';

const SALE_CACHE_TTL_MS = 300_000;
const DEFAULT_BID_INCREMENT = 1;

// Mirrors assertBidMeetsMinimum inside MongoDB, so the check and the write happen
// in one atomic operation and a concurrent higher bid can never be overwritten.
const MINIMUM_NEXT_BID_EXPRESSION = {
  $add: [
    { $ifNull: ['$currentBid', '$startingBid'] },
    { $ifNull: ['$minimumBidIncrement', DEFAULT_BID_INCREMENT] },
  ],
};

interface Bid {
  userId: Types.ObjectId;
  amount: number;
  timestamp: Date;
}

@Injectable()
export class FlashSaleService {
  private readonly logger = new Logger(FlashSaleService.name);

  constructor(
    @InjectModel(FlashSale.name)
    private readonly flashSaleModel: Model<FlashSaleDocument>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly notificationsService: NotificationsService,
    private readonly productsService: ProductsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async autoStartFlashSalesJob(): Promise<void> {
    await this.autoStartFlashSales();
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async autoEndFlashSalesJob(): Promise<void> {
    await this.autoEndExpiredSales();
  }

  // -----------------------
  // CREATE FLASH SALE
  // -----------------------
  async createFlashSale(vendorId: string, dto: CreateFlashSaleDto): Promise<FlashSaleDocument> {
    this.assertValidSchedule(dto.startTime, dto.endTime);
    await this.productsService.assertVendorOwnsProduct(String(dto.productId), vendorId);

    try {
      const flashSale = new this.flashSaleModel({
        ...dto,
        vendorId,
        status: FlashSaleStatus.UPCOMING,
      });

      const saved = await flashSale.save();
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

    await this.cacheManager.set(cacheKey, sales, SALE_CACHE_TTL_MS);
    return sales;
  }

  // -----------------------
  // GET FLASH SALE BY ID (CACHE FIRST)
  // -----------------------
  async getFlashSaleById(id: string): Promise<FlashSaleDocument> {
    const cacheKey = this.saleCacheKey(id);
    const cached = await this.cacheManager.get<FlashSaleDocument>(cacheKey);
    if (cached) return cached;

    const sale = await this.flashSaleModel
      .findById(id)
      .populate('vendorId productId currentBidder winner', '-password')
      .exec();

    if (!sale) throw new NotFoundException('Flash sale not found');

    await this.cacheManager.set(cacheKey, sale, SALE_CACHE_TTL_MS);
    return sale;
  }

  // -----------------------
  // UPDATE FLASH SALE (owner-only, while still upcoming)
  // -----------------------
  async updateFlashSale(id: string, vendorId: string, dto: UpdateFlashSaleDto): Promise<FlashSaleDocument> {
    const sale = this.getSaleOrThrow(await this.flashSaleModel.findById(id));
    this.assertVendorOwnsSale(sale, vendorId, 'update');
    this.assertSaleIsUpcoming(sale);
    this.assertValidSchedule(dto.startTime ?? sale.startTime, dto.endTime ?? sale.endTime);

    const updated = await this.flashSaleModel.findOneAndUpdate(
      { _id: id, status: FlashSaleStatus.UPCOMING },
      { $set: dto },
      { new: true },
    );
    if (!updated) throw new ConflictException('Flash sale has already started and can no longer be edited');

    await this.evictSaleCache(id);
    this.logger.log(`🔄 Flash sale updated: ${id}`);
    return updated;
  }

  private assertSaleIsUpcoming(sale: FlashSaleDocument) {
    if (sale.status !== FlashSaleStatus.UPCOMING)
      throw new ConflictException('Only upcoming flash sales can be edited');
  }

  private assertValidSchedule(startTime: Date, endTime: Date) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (start >= end) throw new BadRequestException('startTime must be before endTime');
    if (end <= Date.now()) throw new BadRequestException('endTime must be in the future');
  }

  // -----------------------
  // PLACE BID (single atomic conditional update)
  // -----------------------
  async placeBid(flashSaleId: string, userId: string, dto: PlaceBidDto): Promise<FlashSaleDocument> {
    const now = new Date();
    const sale = this.getSaleOrThrow(await this.flashSaleModel.findById(flashSaleId));
    this.assertSaleIsActive(sale);
    this.assertWithinBiddingWindow(sale, now);
    this.assertBidMeetsMinimum(sale, dto.amount);

    const bid: Bid = { userId: new Types.ObjectId(userId), amount: dto.amount, timestamp: now };
    const saleBeforeBid = await this.recordBidIfStillHighest(flashSaleId, bid);
    await this.evictSaleCache(flashSaleId);
    await this.notifyOutbidUser(saleBeforeBid, bid);

    this.logger.log(`💰 New bid placed: ${dto.amount} by ${userId} on ${flashSaleId}`);
    return this.applyBid(saleBeforeBid, bid);
  }

  private assertSaleIsActive(sale: FlashSaleDocument) {
    if (sale.status !== FlashSaleStatus.ACTIVE)
      throw new BadRequestException('Bidding is only allowed on active flash sales');
  }

  // The status can lag the schedule by one cron tick, so the clock is authoritative.
  private assertWithinBiddingWindow(sale: FlashSaleDocument, now: Date) {
    if (now < new Date(sale.startTime)) throw new BadRequestException('This flash sale has not started yet');
    if (now >= new Date(sale.endTime)) throw new BadRequestException('This flash sale has ended');
  }

  private assertBidMeetsMinimum(sale: FlashSaleDocument, amount: number) {
    const minAllowed = this.getMinimumNextBid(sale);
    if (amount < minAllowed) throw new BadRequestException(`Bid must be at least ${minAllowed}`);
  }

  private getMinimumNextBid(sale: FlashSaleDocument): number {
    return (sale.currentBid ?? sale.startingBid) + (sale.minimumBidIncrement ?? DEFAULT_BID_INCREMENT);
  }

  // Returns the sale as it was just before this bid, so the outbid user is exactly
  // the one this bid displaced, even when other bids land concurrently.
  private async recordBidIfStillHighest(flashSaleId: string, bid: Bid): Promise<FlashSaleDocument> {
    const saleBeforeBid = await this.flashSaleModel
      .findOneAndUpdate(
        this.buildOpenForBidFilter(flashSaleId, bid),
        { $set: { currentBid: bid.amount, currentBidder: bid.userId }, $push: { bids: bid } },
        { new: false },
      )
      .populate('productId', 'name');

    if (!saleBeforeBid)
      throw new ConflictException('A higher bid was placed or the sale closed first. Refresh and try again');
    return saleBeforeBid;
  }

  private buildOpenForBidFilter(flashSaleId: string, bid: Bid): FilterQuery<FlashSaleDocument> {
    return {
      _id: flashSaleId,
      status: FlashSaleStatus.ACTIVE,
      startTime: { $lte: bid.timestamp },
      endTime: { $gt: bid.timestamp },
      $expr: { $lte: [MINIMUM_NEXT_BID_EXPRESSION, bid.amount] },
    };
  }

  private applyBid(sale: FlashSaleDocument, bid: Bid): FlashSaleDocument {
    sale.currentBid = bid.amount;
    sale.currentBidder = bid.userId;
    sale.bids.push(bid);
    return sale;
  }

  private async notifyOutbidUser(saleBeforeBid: FlashSaleDocument, bid: Bid) {
    const previousBidder = saleBeforeBid.currentBidder;
    if (!previousBidder || previousBidder.toString() === bid.userId.toString()) return;

    const saleId = (saleBeforeBid._id as Types.ObjectId).toString();
    const productName = (saleBeforeBid.productId as any)?.name || saleId;
    try {
      await this.notificationsService.notify(
        previousBidder.toString(),
        'customer',
        'flash_sale_alert',
        'Outbid!',
        `You've been outbid on ${productName}`,
        { flashSaleId: saleId, currentBid: bid.amount, yourBid: saleBeforeBid.currentBid },
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
    await this.evictSaleCache(flashSaleId);
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
    await this.evictSaleCache(dto.flashSaleId.toString());
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

  // -----------------------
  // AUTO-START UPCOMING SALES (cron job)
  // -----------------------
  async autoStartFlashSales(): Promise<number> {
    const due = await this.flashSaleModel
      .find({ status: FlashSaleStatus.UPCOMING, startTime: { $lte: new Date() } })
      .select('_id');
    if (due.length === 0) return 0;

    const ids = due.map((sale) => sale._id as Types.ObjectId);
    const result = await this.flashSaleModel.updateMany(
      { _id: { $in: ids }, status: FlashSaleStatus.UPCOMING },
      { $set: { status: FlashSaleStatus.ACTIVE } },
    );
    await Promise.all(ids.map((id) => this.evictSaleCache(id.toString())));

    this.logger.log(`🚀 Activated ${result.modifiedCount} flash sales`);
    return result.modifiedCount;
  }

  // -----------------------
  // AUTO-END EXPIRED SALES (cron job)
  // -----------------------
  async autoEndExpiredSales(): Promise<number> {
    const expired = await this.flashSaleModel.find({
      status: FlashSaleStatus.ACTIVE,
      endTime: { $lte: new Date() },
    });

    let count = 0;
    for (const sale of expired) {
      if (await this.endExpiredSale(sale)) count++;
    }

    if (count > 0) this.logger.log(`🕒 Auto-ended ${count} expired flash sales`);
    return count;
  }

  // Bids are refused once endTime has passed, so the current highest bidder is final
  // and becomes the winner. The status guard makes only one cron run end the sale.
  private async endExpiredSale(sale: FlashSaleDocument): Promise<boolean> {
    const saleId = (sale._id as Types.ObjectId).toString();
    const ended = await this.flashSaleModel.findOneAndUpdate(
      { _id: saleId, status: FlashSaleStatus.ACTIVE },
      {
        $set: {
          status: FlashSaleStatus.COMPLETED,
          reason: FlashSaleReason.CLOSING_TIME,
          ...(sale.currentBidder && { winner: sale.currentBidder }),
        },
      },
      { new: true },
    );
    if (!ended) return false;

    await this.evictSaleCache(saleId);
    await this.notifyWinner(ended);
    return true;
  }

  private saleCacheKey(id: string): string {
    return `flash-sale:${id}`;
  }

  private async evictSaleCache(id: string): Promise<void> {
    await this.cacheManager.del(this.saleCacheKey(id));
  }
}
