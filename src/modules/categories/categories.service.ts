import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";

import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { Category, CategoryDocument } from "./schema/category.schema";

export interface ActiveCategorySummary {
  id: string;
  name: string;
  icon?: string;
  productCount: number;
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel("Product") private readonly productModel: Model<any>
  ) {}

  async create(dto: CreateCategoryDto): Promise<CategoryDocument> {
    const existing = await this.categoryModel.findOne({
      name: new RegExp(`^${escapeRegex(dto.name)}$`, "i"),
    });
    if (existing) throw new ConflictException("Category name already exists");

    try {
      return await new this.categoryModel(dto).save();
    } catch (err) {
      this.logger.error("Error saving category", err);
      throw new InternalServerErrorException("Failed to create category");
    }
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException("Invalid category id");

    const category = await this.categoryModel.findById(id);
    if (!category) throw new NotFoundException("Category not found");

    Object.assign(category, dto);

    try {
      return await category.save();
    } catch (err) {
      this.logger.error("Error updating category", err);
      throw new InternalServerErrorException("Failed to update category");
    }
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException("Invalid category id");

    const category = await this.categoryModel.findById(id);
    if (!category) throw new NotFoundException("Category not found");

    category.isActive = false;
    await category.save();
  }

  async listActive(): Promise<ActiveCategorySummary[]> {
    const categories = await this.categoryModel.find({ isActive: true }).sort({ sortOrder: 1 });

    return Promise.all(categories.map((category) => this.toActiveSummary(category)));
  }

  async assertActiveCategory(name: string): Promise<void> {
    const category = await this.categoryModel.findOne({ name, isActive: true });
    if (!category) throw new BadRequestException("Invalid or inactive category: " + name);
  }

  private async toActiveSummary(category: CategoryDocument): Promise<ActiveCategorySummary> {
    const productCount = await this.productModel.countDocuments({ category: category.name });

    return {
      id: (category._id as Types.ObjectId).toString(),
      name: category.name,
      icon: category.icon,
      productCount,
    };
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
