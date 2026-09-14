/* src/products/products.service.ts */
import {
  Injectable,
  NotFoundException,
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
import { UpdatePriceDto } from "./dto/update-price.dto";
import { FilterProductDto } from "./dto/filter-product.dto";
import { NearbyQueryDto } from "./dto/nearby-query.dto";
import { UpdateAvailabilityDto } from "./dto/update-availability.dto";

/* Replace with your actual product schema import */
import { Product, ProductDocument } from "./schema/product.schema";
import { Vendor, VendorDocument } from "../vendors/schema/vendor.schema";
import { CategoriesService } from "../categories/categories.service";

const DEFAULT_RADIUS_KM = 5;
const METERS_PER_KILOMETER = 1000;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

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

export interface NearbyProduct {
  _id: string;
  name: string;
  price: number;
  images: string[];
  category: string;
  rating?: { average: number; count: number };
  vendorId: string;
  vendorName: string;
  distance: number;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(Vendor.name) private readonly vendorModel: Model<VendorDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly categoriesService: CategoriesService
  ) {}
  async createProduct(dto: CreateProductDto,vendorId:string): Promise<{ product: SafeProduct }> {
    // Expect dto.vendorId provided by controller (from auth)
    if (!vendorId) throw new BadRequestException("vendorId is required");

    if (!Types.ObjectId.isValid(vendorId)) throw new BadRequestException("Invalid vendorId");

    await this.categoriesService.assertActiveCategory(dto.category);

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
  async updateProduct(productId: string, actorId: string, dto: UpdateProductDto): Promise<SafeProduct> {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    // Ownership: only vendor who created product can update
    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to update this product");
    }

    if (dto.category) {
      await this.categoriesService.assertActiveCategory(dto.category);
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
  // NEARBY PRODUCTS (geospatial, via Vendor.location)
  // -----------------------
  async getNearbyProducts(dto: NearbyQueryDto): Promise<{ items: NearbyProduct[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, Number(dto.page) || DEFAULT_PAGE);
    const limit = Math.max(1, Number(dto.limit) || DEFAULT_LIMIT);
    const skip = (page - 1) * limit;

    const pipeline = this.buildNearbyPipeline(dto);

    const [items, countResult] = await Promise.all([
      this.vendorModel.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
      this.vendorModel.aggregate([...pipeline, { $count: "total" }]),
    ]);

    const total = countResult[0]?.total ?? 0;
    return { items, total, page, limit };
  }

  private buildNearbyPipeline(dto: NearbyQueryDto): any[] {
    const radiusMeters = (dto.radius ?? DEFAULT_RADIUS_KM) * METERS_PER_KILOMETER;

    return [
      {
        $geoNear: {
          near: { type: "Point", coordinates: [dto.longitude, dto.latitude] },
          distanceField: "distance",
          maxDistance: radiusMeters,
          spherical: true,
          query: { isActive: true },
          key: "location.coordinates",
        },
      },
      { $lookup: { from: "products", localField: "_id", foreignField: "vendorId", as: "products" } },
      { $unwind: "$products" },
      {
        $match: {
          "products.isAvailable": true,
          ...(dto.category && { "products.category": dto.category }),
        },
      },
      {
        $project: {
          _id: "$products._id",
          name: "$products.name",
          price: "$products.price",
          images: "$products.images",
          category: "$products.category",
          rating: "$products.rating",
          vendorId: "$_id",
          vendorName: "$profile.businessName",
          distance: 1,
        },
      },
      { $sort: { distance: 1 } },
    ];
  }

  // -----------------------
  // UPDATE STOCK (owner-only)
  // -----------------------
  async updateStock(productId: string, actorId: string, dto: { stock: number }): Promise<{ productId: string; stock: number }> {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to update stock for this product");
    }

    product.stock = dto.stock;
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
  // UPDATE AVAILABILITY (owner-only)
  // -----------------------
  async updateAvailability(productId: string, actorId: string, dto: UpdateAvailabilityDto): Promise<SafeProduct> {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to update this product");
    }

    product.isAvailable = dto.isAvailable;
    await product.save();

    await this.invalidateProductListCaches();
    await this.cacheManager.del(`product:${productId}`);

    return this.toSafeProduct(product);
  }

  // -----------------------
  // ADD PRODUCT IMAGES (owner-only)
  // -----------------------
  async addProductImages(productId: string, actorId: string, urls: string[]): Promise<string[]> {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid productId");

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException("Product not found");

    if (!product.vendorId || product.vendorId.toString() !== actorId) {
      throw new ForbiddenException("Not allowed to update this product");
    }

    product.images.push(...urls);
    await product.save();

    await this.invalidateProductListCaches();
    await this.cacheManager.del(`product:${productId}`);

    return product.images;
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
