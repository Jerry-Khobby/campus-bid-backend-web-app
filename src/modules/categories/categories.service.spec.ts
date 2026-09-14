import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Types } from "mongoose";

import { CategoriesService } from "./categories.service";
import { Category } from "./schema/category.schema";

describe("CategoriesService", () => {
  let service: CategoriesService;
  let categoryModel: any;
  let productModel: any;

  const mockCategoryId = new Types.ObjectId().toString();

  beforeEach(async () => {
    categoryModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ ...dto, _id: mockCategoryId }),
    }));
    categoryModel.findOne = jest.fn();
    categoryModel.findById = jest.fn();
    categoryModel.find = jest.fn();

    productModel = { countDocuments: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getModelToken(Category.name), useValue: categoryModel },
        { provide: getModelToken("Product"), useValue: productModel },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  describe("create", () => {
    it("creates a category when the name is unique", async () => {
      categoryModel.findOne.mockResolvedValue(null);

      const result = await service.create({ name: "Food" } as any);

      expect(result).toBeDefined();
      expect(categoryModel.findOne).toHaveBeenCalled();
    });

    it("throws ConflictException when the name already exists", async () => {
      categoryModel.findOne.mockResolvedValue({ name: "Food" });

      await expect(service.create({ name: "Food" } as any)).rejects.toThrow(ConflictException);
    });
  });

  describe("update", () => {
    it("throws BadRequestException for an invalid id", async () => {
      await expect(service.update("invalid-id", {} as any)).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException when the category does not exist", async () => {
      categoryModel.findById.mockResolvedValue(null);

      await expect(service.update(mockCategoryId, {} as any)).rejects.toThrow(NotFoundException);
    });

    it("updates and saves an existing category", async () => {
      const save = jest.fn().mockResolvedValue({ name: "Books" });
      categoryModel.findById.mockResolvedValue({ name: "Food", save });

      await service.update(mockCategoryId, { name: "Books" } as any);

      expect(save).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("throws NotFoundException when the category does not exist", async () => {
      categoryModel.findById.mockResolvedValue(null);

      await expect(service.remove(mockCategoryId)).rejects.toThrow(NotFoundException);
    });

    it("soft-deletes by setting isActive to false", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const category = { isActive: true, save };
      categoryModel.findById.mockResolvedValue(category);

      await service.remove(mockCategoryId);

      expect(category.isActive).toBe(false);
      expect(save).toHaveBeenCalled();
    });
  });

  describe("assertActiveCategory", () => {
    it("resolves when an active category is found", async () => {
      categoryModel.findOne.mockResolvedValue({ name: "Food", isActive: true });

      await expect(service.assertActiveCategory("Food")).resolves.toBeUndefined();
    });

    it("throws BadRequestException when no active category is found", async () => {
      categoryModel.findOne.mockResolvedValue(null);

      await expect(service.assertActiveCategory("Missing")).rejects.toThrow(BadRequestException);
    });
  });

  describe("listActive", () => {
    it("returns active categories with computed product counts", async () => {
      categoryModel.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue([
          { _id: mockCategoryId, name: "Food", icon: "icon.svg", sortOrder: 0 },
        ]),
      });
      productModel.countDocuments.mockResolvedValue(3);

      const result = await service.listActive();

      expect(result).toEqual([{ id: mockCategoryId, name: "Food", icon: "icon.svg", productCount: 3 }]);
    });
  });
});
