import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Types } from "mongoose";

import { ProductsService } from "./products.service";
import { Product } from "./schema/product.schema";
import { Vendor } from "../vendors/schema/vendor.schema";
import { CategoriesService } from "../categories/categories.service";

describe("ProductsService", () => {
  let service: ProductsService;
  let productModel: any;
  let vendorModel: any;
  let cacheManager: any;
  let categoriesService: any;

  const vendorId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();

  beforeEach(async () => {
    productModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ ...dto, _id: productId, toObject: () => ({ ...dto, _id: productId }) }),
    }));
    productModel.findById = jest.fn();
    productModel.find = jest.fn();
    productModel.countDocuments = jest.fn();
    productModel.findByIdAndDelete = jest.fn();

    vendorModel = { aggregate: jest.fn(), find: jest.fn() };

    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    categoriesService = { assertActiveCategory: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe("createProduct", () => {
    it("validates the category is active before creating the product", async () => {
      await service.createProduct({ name: "Sandwich", category: "Food", price: 10 } as any, vendorId);

      expect(categoriesService.assertActiveCategory).toHaveBeenCalledWith("Food");
    });

    it("propagates BadRequestException when the category is invalid", async () => {
      categoriesService.assertActiveCategory.mockRejectedValue(new BadRequestException("Invalid or inactive category"));

      await expect(
        service.createProduct({ name: "Sandwich", category: "Bad", price: 10 } as any, vendorId)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateProduct", () => {
    it("validates the category only when it is present in the update", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const product = { vendorId, save, toObject: () => ({ _id: productId, vendorId }) };
      productModel.findById.mockResolvedValue(product);

      await service.updateProduct(productId, vendorId, { name: "New name" } as any);

      expect(categoriesService.assertActiveCategory).not.toHaveBeenCalled();
    });

    it("validates the category when it is present in the update", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const product = { vendorId, save, toObject: () => ({ _id: productId, vendorId }) };
      productModel.findById.mockResolvedValue(product);

      await service.updateProduct(productId, vendorId, { category: "Books" } as any);

      expect(categoriesService.assertActiveCategory).toHaveBeenCalledWith("Books");
    });

    it("throws ForbiddenException when the actor does not own the product", async () => {
      productModel.findById.mockResolvedValue({ vendorId: new Types.ObjectId().toString() });

      await expect(
        service.updateProduct(productId, vendorId, { category: "Books" } as any)
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("updateStock", () => {
    it("updates stock for the owning vendor", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const product = { vendorId, stock: 5, save };
      productModel.findById.mockResolvedValue(product);

      const result = await service.updateStock(productId, vendorId, { stock: 20 });

      expect(product.stock).toBe(20);
      expect(save).toHaveBeenCalled();
      expect(result).toEqual({ productId, stock: 20 });
    });

    it("throws NotFoundException when the product does not exist", async () => {
      productModel.findById.mockResolvedValue(null);

      await expect(service.updateStock(productId, vendorId, { stock: 20 })).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when the actor does not own the product", async () => {
      productModel.findById.mockResolvedValue({ vendorId: new Types.ObjectId().toString() });

      await expect(service.updateStock(productId, vendorId, { stock: 20 })).rejects.toThrow(ForbiddenException);
    });
  });

  describe("updateAvailability", () => {
    it("updates isAvailable for the owning vendor", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const product = { vendorId, isAvailable: true, save, toObject: () => ({ _id: productId, vendorId, isAvailable: false }) };
      productModel.findById.mockResolvedValue(product);

      await service.updateAvailability(productId, vendorId, { isAvailable: false });

      expect(product.isAvailable).toBe(false);
      expect(save).toHaveBeenCalled();
    });

    it("throws ForbiddenException when the actor does not own the product", async () => {
      productModel.findById.mockResolvedValue({ vendorId: new Types.ObjectId().toString() });

      await expect(
        service.updateAvailability(productId, vendorId, { isAvailable: false })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("addProductImages", () => {
    it("appends the new image urls for the owning vendor", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const product = { vendorId, images: ["existing.jpg"], save };
      productModel.findById.mockResolvedValue(product);

      const result = await service.addProductImages(productId, vendorId, ["new1.jpg", "new2.jpg"]);

      expect(result).toEqual(["existing.jpg", "new1.jpg", "new2.jpg"]);
      expect(save).toHaveBeenCalled();
    });

    it("throws ForbiddenException when the actor does not own the product", async () => {
      productModel.findById.mockResolvedValue({ vendorId: new Types.ObjectId().toString(), images: [] });

      await expect(service.addProductImages(productId, vendorId, ["new.jpg"])).rejects.toThrow(ForbiddenException);
    });
  });

  describe("getNearbyProducts", () => {
    it("returns paginated nearby products with the total count", async () => {
      const nearbyItem = { _id: productId, name: "Sandwich", distance: 120 };
      vendorModel.aggregate
        .mockResolvedValueOnce([nearbyItem])
        .mockResolvedValueOnce([{ total: 1 }]);

      const result = await service.getNearbyProducts({ latitude: 5.6, longitude: -0.2 } as any);

      expect(result).toEqual({ items: [nearbyItem], total: 1, page: 1, limit: 10 });
      expect(vendorModel.aggregate).toHaveBeenCalledTimes(2);
    });

    it("returns a total of zero when no vendors are nearby", async () => {
      vendorModel.aggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.getNearbyProducts({ latitude: 5.6, longitude: -0.2 } as any);

      expect(result.total).toBe(0);
    });
  });

  describe("listProducts", () => {
    function mockProductFind(items: any[]) {
      const lean = jest.fn().mockResolvedValue(items);
      const limit = jest.fn().mockReturnValue({ lean });
      const skip = jest.fn().mockReturnValue({ limit });
      const sort = jest.fn().mockReturnValue({ skip });
      productModel.find.mockReturnValue({ sort });
    }

    function mockVendorFind(vendors: any[]) {
      const lean = jest.fn().mockResolvedValue(vendors);
      const select = jest.fn().mockReturnValue({ lean });
      vendorModel.find.mockReturnValue({ select });
    }

    it("attaches each product's vendor business name from a single batched lookup", async () => {
      const otherVendorId = new Types.ObjectId().toString();
      mockProductFind([
        { _id: productId, vendorId, name: "Beans" },
        { _id: new Types.ObjectId().toString(), vendorId: otherVendorId, name: "Rice" },
      ]);
      mockVendorFind([
        { _id: vendorId, profile: { businessName: "Campus Bakery" } },
        { _id: otherVendorId, profile: { businessName: "Study Supply Co" } },
      ]);
      productModel.countDocuments.mockResolvedValue(2);

      const result = await service.listProducts({} as any);

      expect(vendorModel.find).toHaveBeenCalledWith({ _id: { $in: expect.arrayContaining([vendorId, otherVendorId]) } });
      expect(result.items.map((i) => i.vendorName)).toEqual(["Campus Bakery", "Study Supply Co"]);
    });

    it("still returns products when a product's vendor no longer exists", async () => {
      mockProductFind([{ _id: productId, vendorId, name: "Beans" }]);
      mockVendorFind([]);
      productModel.countDocuments.mockResolvedValue(1);

      const result = await service.listProducts({} as any);

      expect(result.items[0].vendorName).toBeUndefined();
      expect(result.items[0].name).toBe("Beans");
    });

    it("skips the vendor lookup entirely when the page has no products", async () => {
      mockProductFind([]);
      productModel.countDocuments.mockResolvedValue(0);

      const result = await service.listProducts({} as any);

      expect(vendorModel.find).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
    });
  });
});
