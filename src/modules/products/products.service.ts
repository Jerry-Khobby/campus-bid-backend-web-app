/* src/products/products.service.ts */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
  Inject,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";

import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateStockDto } from "./dto/update-stock.dto";
import { UpdatePriceDto } from "./dto/update-price.dto";
import { FilterProductDto } from "./dto/filter-product.dto";
import { ProductRatingDto } from "./dto/product-rating.dto";

/* Replace with your actual product schema import */
import { Product, ProductDocument } from "./schema/product.schema";

export interface SafeProduct {
  _id: string;
  vendorId: string;
  name: string;
  description?: string;
  category: string;
  images?: string[];
  price: number;
  discountPrice?: number;
  stock?: number;
  isAvailable?: boolean;
  preparationTime?: number;
  tags?: string[];
  specifications?: any;
  rating?: { average: number; count: number };
  isFlashSale?: boolean;
  flashSaleId?: string;
  views?: number;
  soldCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  // -----------------------
  // CREATE
  // -----------------------
  async createProduct(dto: CreateProductDto,vendorId:string): Promise<{ product: SafeProduct }> {
    // Expect dto.vendorId provided by controller (from auth)
    if (!vendorId) throw new BadRequestException("vendorId is required");

    if (!Types.ObjectId.isValid(vendorId)) throw new BadRequestException("Invalid vendorId");

    const product = new this.productModel({
      vendorId: new Types.ObjectId(vendorId),
      name: dto.name,
      description: dto.description ?? "",
      category: dto.category,
      images: dto.images ?? [],
      price: dto.price,
      discountPrice: dto.discountPrice,
      stock: dto.stock ?? 0,
      isAvailable: typeof dto.isAvailable === "boolean" ? dto.isAvailable : true,
      preparationTime: dto.preparationTime,
      tags: dto.tags ?? [],
      specifications: dto.specifications ?? {},
      rating: { average: 0, count: 0 },
      isFlashSale: dto.isFlashSale ?? false,
      flashSaleId: dto.flashSaleId ? new Types.ObjectId(dto.flashSaleId) : undefined,
      views: 0,
      soldCount: 0,
    });

    let saved: ProductDocument;
    try {
      saved = (await product.save()) as ProductDocument;
    } catch (err) {
      this.logger.error("Error saving product", err);
      throw new InternalServerErrorException("Failed to create product");
    }

    // Invalidate product list caches
    await this.invalidateProductListCaches();

    return { product: this.toSafeProduct(saved) };
  }

  // -----------------------
  // UPDATE (owner-only)
  // -----------------------
  async updateProduct(productId: string, actorId: string, dto: UpdateProductDto): Promise<SafeProduct> {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    // Ownership: only vendor who created product can update
    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to update this product");
    }

    // Merge allowed fields from DTO
    const updatable = [
      "name",
      "description",
      "category",
      "images",
      "price",
      "discountPrice",
      "stock",
      "isAvailable",
      "preparationTime",
      "tags",
      "specifications",
      "isFlashSale",
      "flashSaleId",
    ];
    updatable.forEach((k) => {
      if (k in dto) {
        (product as any)[k] = (dto as any)[k];
      }
    });

    await product.save();

    await this.invalidateProductListCaches();
    await this.cacheManager.del(`product:${productId}`);

    return this.toSafeProduct(product);
  }

  // -----------------------
  // GET BY ID
  // -----------------------
  async getProductById(productId: string): Promise<SafeProduct> {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const cacheKey = `product:${productId}`;
    const cached = await this.cacheManager.get<SafeProduct>(cacheKey);
    if (cached) return cached;

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    const safe = this.toSafeProduct(product);
    await this.cacheManager.set(cacheKey, safe, 60);

    return safe;
  }

  // -----------------------
  // LIST / FILTER / PAGINATE
  // -----------------------
  async listProducts(filter: FilterProductDto): Promise<{ items: SafeProduct[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.max(1, Number(filter.limit) || 10);
    const skip = (page - 1) * limit;

    const query: any = {};
    if (filter.search) {
      const rx = new RegExp(escapeRegex(filter.search), "i");
      query.$or = [{ name: rx }, { description: rx }, { tags: rx }];
    }
    if (filter.category) query.category = filter.category;
    if (filter.vendorId && Types.ObjectId.isValid(filter.vendorId)) query.vendorId = new Types.ObjectId(filter.vendorId);
    if (typeof filter.isAvailable !== "undefined") query.isAvailable = filter.isAvailable;
    if (typeof filter.isFlashSale !== "undefined") query.isFlashSale = filter.isFlashSale;

    // cache key
    const cacheKey = `products:${JSON.stringify({ q: query, page, limit })}`;
    const cached = await this.cacheManager.get<{ items: SafeProduct[]; total: number }>(cacheKey);
    if (cached) {
      this.logger.log(`Products served from cache (${cacheKey})`);
      return { items: cached.items, total: cached.total, page, limit };
    }

    const [rawItems, total] = await Promise.all([
      this.productModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.productModel.countDocuments(query),
    ]);

    const items = rawItems.map((r) => this.toSafeProductFromObject(r));
    await this.cacheManager.set(cacheKey, { items, total },60);

    return { items, total, page, limit };
  }

  // -----------------------
  // UPDATE STOCK (owner-only)
  // -----------------------
  async updateStock(dto: UpdateStockDto, actorId: string): Promise<{ productId: string; stock: number }> {
    const { productId, stock } = dto;
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to update stock for this product");
    }

    product.stock = stock;
    await product.save();

    await this.invalidateProductListCaches();
    await this.cacheManager.del(`product:${productId}`);

    return { productId, stock: product.stock ?? 0 };
  }

  // -----------------------
  // UPDATE PRICE (owner-only)
  // -----------------------
  async updatePrice(dto: UpdatePriceDto, actorId: string): Promise<{ productId: string; price: number; discountPrice?: number }> {
    const { productId, price, discountPrice } = dto;
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to update price for this product");
    }

    product.price = price;
    if (typeof discountPrice !== "undefined") product.discountPrice = discountPrice;
    await product.save();

    await this.invalidateProductListCaches();
    await this.cacheManager.del(`product:${productId}`);

    return { productId, price: product.price, discountPrice: product.discountPrice };
  }

  // -----------------------
  // RATE PRODUCT
  // -----------------------
  async rateProduct(dto: ProductRatingDto): Promise<{ productId: string; rating: { average: number; count: number } }> {
    const { productId, rating } = dto;
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");
    if (rating < 1 || rating > 5) throw new BadRequestException("Rating must be between 1 and 5");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    const current = product.rating ?? { average: 0, count: 0 };
    const newCount = (current.count || 0) + 1;
    const newAvg = ((current.average || 0) * (current.count || 0) + rating) / newCount;

    product.rating = { average: Number(newAvg.toFixed(2)), count: newCount };
    await product.save();

    await this.invalidateProductListCaches();
    await this.cacheManager.del(`product:${productId}`);

    return { productId, rating: product.rating };
  }

  // -----------------------
  // DELETE PRODUCT (owner-only)
  // -----------------------
  async deleteProduct(productId: string, actorId: string): Promise<{ success: true }> {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to delete this product");
    }

    await this.productModel.findByIdAndDelete(productId);

    await this.invalidateProductListCaches();
    await this.cacheManager.del(`product:${productId}`);

    return { success: true };
  }

  // -----------------------
  // Helpers
  // -----------------------
  private toSafeProduct(doc: ProductDocument): SafeProduct {
    const obj = doc.toObject ? doc.toObject() : (doc as any);
    return this.toSafeProductFromObject(obj);
  }

  private toSafeProductFromObject(obj: any): SafeProduct {
    const {
      _id,
      vendorId,
      name,
      description,
      category,
      images,
      price,
      discountPrice,
      stock,
      isAvailable,
      preparationTime,
      tags,
      specifications,
      rating,
      isFlashSale,
      flashSaleId,
      views,
      soldCount,
      createdAt,
      updatedAt,
    } = obj;

    return {
      _id: (_id as Types.ObjectId).toString(),
      vendorId: vendorId ? vendorId.toString() : null,
      name,
      description,
      category,
      images: images ?? [],
      price,
      discountPrice,
      stock,
      isAvailable,
      preparationTime,
      tags: tags ?? [],
      specifications: specifications ?? {},
      rating: rating ?? { average: 0, count: 0 },
      isFlashSale: !!isFlashSale,
      flashSaleId: flashSaleId ? flashSaleId.toString() : undefined,
      views: views ?? 0,
      soldCount: soldCount ?? 0,
      createdAt,
      updatedAt,
    } as SafeProduct;
  }

  private async invalidateProductListCaches() {
    try {
      const store = (this.cacheManager as any).store;
      if (store && typeof store.keys === "function") {
        // pattern depends on store implementation. For redis-store, keys can accept pattern.
        const keys = await store.keys?.("products:*");
        if (Array.isArray(keys) && keys.length) {
          await Promise.all(keys.map((k: string) => this.cacheManager.del(k)));
        }
      }
    } catch (err) {
      // Non-fatal: log and continue
      this.logger.debug("Could not invalidate product-list caches by pattern");
    }
  }
}

/* Utility */
function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
