import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Types } from "mongoose";

import { ReviewsService } from "./reviews.service";
import { Review } from "./schema/review.schema";

describe("ReviewsService", () => {
  let service: ReviewsService;
  let reviewModel: any;
  let orderModel: any;
  let productModel: any;
  let vendorModel: any;

  const customerId = new Types.ObjectId().toString();
  const orderId = new Types.ObjectId().toString();
  const vendorId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();

  const baseDto = {
    orderId,
    vendorId,
    rating: 5,
    productRatings: [{ productId, rating: 4 }],
  };

  beforeEach(async () => {
    reviewModel = { create: jest.fn(), find: jest.fn(), countDocuments: jest.fn() };
    orderModel = { findById: jest.fn() };
    productModel = { findById: jest.fn() };
    vendorModel = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getModelToken(Review.name), useValue: reviewModel },
        { provide: getModelToken("Order"), useValue: orderModel },
        { provide: getModelToken("Product"), useValue: productModel },
        { provide: getModelToken("Vendor"), useValue: vendorModel },
      ],
    }).compile();

    service = module.get<ReviewsService>(ReviewsService);
  });

  describe("createReview", () => {
    it("throws NotFoundException when the order does not exist", async () => {
      orderModel.findById.mockResolvedValue(null);

      await expect(service.createReview(customerId, baseDto as any)).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when the order belongs to another customer", async () => {
      orderModel.findById.mockResolvedValue({ customerId: { toString: () => "someone-else" }, status: "completed" });

      await expect(service.createReview(customerId, baseDto as any)).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when the order is not completed", async () => {
      orderModel.findById.mockResolvedValue({ customerId: { toString: () => customerId }, status: "pending" });

      await expect(service.createReview(customerId, baseDto as any)).rejects.toThrow(BadRequestException);
    });

    it("throws ConflictException on a duplicate review for the same order/product", async () => {
      orderModel.findById.mockResolvedValue({ customerId: { toString: () => customerId }, status: "completed" });
      reviewModel.create.mockRejectedValue({ code: 11000 });

      await expect(service.createReview(customerId, baseDto as any)).rejects.toThrow(ConflictException);
    });

    it("creates reviews and recomputes product and vendor ratings", async () => {
      orderModel.findById.mockResolvedValue({ customerId: { toString: () => customerId }, status: "completed" });
      reviewModel.create.mockResolvedValue({});

      const productSave = jest.fn().mockResolvedValue(true);
      productModel.findById.mockResolvedValue({ rating: { average: 0, count: 0 }, save: productSave });

      const vendorSave = jest.fn().mockResolvedValue(true);
      vendorModel.findById.mockResolvedValue({ rating: { average: 0, count: 0 }, save: vendorSave });

      const result = await service.createReview(customerId, baseDto as any);

      expect(result).toEqual({ orderId, reviewsCreated: 1 });
      expect(productSave).toHaveBeenCalled();
      expect(vendorSave).toHaveBeenCalled();
    });
  });

  describe("listVendorReviews", () => {
    it("returns paginated reviews for a vendor", async () => {
      const populate = jest.fn().mockReturnThis();
      const skip = jest.fn().mockReturnThis();
      const limit = jest.fn().mockResolvedValue([{ rating: 5 }]);
      reviewModel.find.mockReturnValue({ populate, skip, limit });
      reviewModel.countDocuments.mockResolvedValue(1);

      const result = await service.listVendorReviews(vendorId, { page: 1, limit: 10 } as any);

      expect(result).toEqual({ items: [{ rating: 5 }], total: 1, page: 1, limit: 10 });
    });
  });
});
