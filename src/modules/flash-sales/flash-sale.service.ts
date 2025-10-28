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
  FlashSaleStatus,
  FlashSaleReason,
} from './dto';
import { FlashSale, FlashSaleDocument } from './schema/flash-sale.schema';


@Injectable()
export class FlashSaleService {
  private readonly logger = new Logger(FlashSaleService.name);

  constructor(
    @InjectModel(FlashSale.name)
    private readonly flashSaleModel: Model<FlashSaleDocument>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // -----------------------
  // CREATE FLASH SALE
  // -----------------------
  async createFlashSale(dto: CreateFlashSaleDto): Promise<FlashSaleDocument> {
    try {
      const flashSale = new this.flashSaleModel({
        ...dto,
        status: FlashSaleStatus.UPCOMING,
      });

      const saved = await flashSale.save();
      await this.cacheManager.set(`flash-sale:${saved._id}`, saved, 600);

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

    await this.cacheManager.set(cacheKey, sales, 300);
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

    await this.cacheManager.set(cacheKey, sale, 300);
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

    await this.cacheManager.set(`flash-sale:${id}`, updated, 600);
    this.logger.log(`🔄 Flash sale updated: ${id}`);

    return updated;
  }

  // -----------------------
  // PLACE BID (Atomic with Cache)
  // -----------------------
  async placeBid(dto: PlaceBidDto): Promise<FlashSaleDocument> {
    const lockKey = `lock:flash-sale:${dto.flashSaleId}`;
    const cachedLock = await this.cacheManager.get(lockKey);
    if (cachedLock) throw new ForbiddenException('Bid is being processed, try again shortly');

    await this.cacheManager.set(lockKey, 'locked', 5);

    try {
      const sale = await this.flashSaleModel.findById(dto.flashSaleId);
      if (!sale) throw new NotFoundException('Flash sale not found');
      if (sale.status !== FlashSaleStatus.ACTIVE)
        throw new BadRequestException('Bidding is only allowed on active flash sales');

      const minAllowed = (sale.currentBid || sale.startingBid) + (sale.minimumBidIncrement || 1);
      if (dto.amount < minAllowed)
        throw new BadRequestException(`Bid must be at least ${minAllowed}`);

      sale.currentBid = dto.amount;
      sale.currentBidder = new Types.ObjectId(dto.userId);
      sale.bids.push({
        userId: new Types.ObjectId(dto.userId),
        amount: dto.amount,
        timestamp: new Date(),
      });

      const updated = await sale.save();
      await this.cacheManager.set(`flash-sale:${dto.flashSaleId}`, updated, 600);

      this.logger.log(`💰 New bid placed: ${dto.amount} by ${dto.userId} on ${dto.flashSaleId}`);
      return updated;
    } finally {
      await this.cacheManager.del(lockKey);
    }
  }

  // -----------------------
  // CANCEL FLASH SALE
  // -----------------------
  async cancelFlashSale(dto: CancelFlashSaleDto): Promise<FlashSaleDocument> {
    const sale = await this.flashSaleModel.findById(dto.flashSaleId);
    if (!sale) throw new NotFoundException('Flash sale not found');

    if (sale.status === FlashSaleStatus.COMPLETED)
      throw new ConflictException('Cannot cancel a completed flash sale');

    sale.status = FlashSaleStatus.CANCELLED;
    sale.reason = dto.reason;
    const updated = await sale.save();

    await this.cacheManager.set(`flash-sale:${dto.flashSaleId}`, updated, 300);
    this.logger.warn(`⚠️ Flash sale cancelled: ${dto.flashSaleId}`);

    return updated;
  }

  // -----------------------
  // COMPLETE FLASH SALE
  // -----------------------
  async completeFlashSale(dto: CompleteFlashSaleDto): Promise<FlashSaleDocument> {
    const sale = await this.flashSaleModel.findById(dto.flashSaleId);
    if (!sale) throw new NotFoundException('Flash sale not found');

    if (sale.status === FlashSaleStatus.COMPLETED)
      throw new ConflictException('Flash sale already completed');

    sale.status = FlashSaleStatus.COMPLETED;
    sale.winner = dto.winner;
    sale.currentBid = dto.finalBid;
    sale.reason = FlashSaleReason.CLOSING_TIME;

    const updated = await sale.save();
    await this.cacheManager.set(`flash-sale:${dto.flashSaleId}`, updated, 300);

    this.logger.log(`🏁 Flash sale completed: ${dto.flashSaleId}, winner: ${dto.winner}`);
    return updated;
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
      await this.cacheManager.set(`flash-sale:${sale._id}`, sale, 300);
      count++;
    }

    if (count > 0) this.logger.log(`🕒 Auto-ended ${count} expired flash sales`);
    return count;
  }
}
