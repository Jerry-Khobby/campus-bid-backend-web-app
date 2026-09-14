import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { CreateReviewDto } from "./dto/create-review.dto";
import { ReviewQueryDto } from "./dto/review-query.dto";
import { Review, ReviewDocument } from "./schema/review.schema";

const DUPLICATE_KEY_ERROR_CODE = 11000;
const COMPLETED_ORDER_STATUS = "completed";

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review.name) private readonly reviewModel: Model<ReviewDocument>,
    @InjectModel("Order") private readonly orderModel: Model<any>,
    @InjectModel("Product") private readonly productModel: Model<any>,
    @InjectModel("Vendor") private readonly vendorModel: Model<any>
  ) {}

  async createReview(customerId: string, dto: CreateReviewDto): Promise<{ orderId: string; reviewsCreated: number }> {
    await this.assertReviewableOrder(dto.orderId, customerId);

    for (const entry of dto.productRatings) {
      await this.createProductReview(dto, entry, customerId);
      await this.applyProductRating(entry.productId, entry.rating);
    }

    await this.applyVendorRating(dto.vendorId, dto.rating);

    return { orderId: dto.orderId, reviewsCreated: dto.productRatings.length };
  }

  async listVendorReviews(vendorId: string, query: ReviewQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 10);
    const skip = (page - 1) * limit;

    const filter: any = { vendorId };
    if (typeof query.rating !== "undefined") filter.rating = query.rating;

    const [items, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .populate("customerId", "profile.firstName profile.lastName")
        .skip(skip)
        .limit(limit),
      this.reviewModel.countDocuments(filter),
    ]);

    return { items, total, page, limit };
  }

  private async assertReviewableOrder(orderId: string, customerId: string): Promise<void> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.customerId.toString() !== customerId) {
      throw new ForbiddenException("Not allowed to review this order");
    }
    if (order.status !== COMPLETED_ORDER_STATUS) {
      throw new BadRequestException("Order must be completed before it can be reviewed");
    }
  }

  private async createProductReview(
    dto: CreateReviewDto,
    entry: { productId: string; rating: number },
    customerId: string
  ): Promise<void> {
    try {
      await this.reviewModel.create({
        orderId: dto.orderId,
        productId: entry.productId,
        vendorId: dto.vendorId,
        customerId,
        rating: entry.rating,
        review: dto.review,
      });
    } catch (err) {
      this.handleReviewCreateError(err);
    }
  }

  private handleReviewCreateError(err: any): never {
    if (err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw new ConflictException("This product was already reviewed for this order");
    }
    this.logger.error("Error saving review", err);
    throw err;
  }

  private async applyProductRating(productId: string, rating: number): Promise<void> {
    const product = await this.productModel.findById(productId);
    if (!product) return;

    product.rating = this.nextRating(product.rating, rating);
    await product.save();
  }

  private async applyVendorRating(vendorId: string, rating: number): Promise<void> {
    const vendor = await this.vendorModel.findById(vendorId);
    if (!vendor) return;

    vendor.rating = this.nextRating(vendor.rating, rating);
    await vendor.save();
  }

  private nextRating(current: { average: number; count: number }, rating: number) {
    const newCount = current.count + 1;
    const newAverage = (current.average * current.count + rating) / newCount;
    return { average: Number(newAverage.toFixed(2)), count: newCount };
  }
}
