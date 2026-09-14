import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { SearchQueryDto } from "./dto/search-query.dto";

const SEARCH_RESULT_LIMIT = 20;
const DEFAULT_SEARCH_TYPE = "all";

export interface SearchResult {
  products: any[];
  vendors: any[];
  totalResults: number;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectModel("Product") private readonly productModel: Model<any>,
    @InjectModel("Vendor") private readonly vendorModel: Model<any>
  ) {}

  async search(dto: SearchQueryDto): Promise<SearchResult> {
    if (!dto.q) throw new BadRequestException('Search query "q" is required');

    const type = dto.type ?? DEFAULT_SEARCH_TYPE;
    const [products, vendors] = await Promise.all([
      this.shouldSearchProducts(type) ? this.searchProducts(dto.q, dto.category) : Promise.resolve([]),
      this.shouldSearchVendors(type) ? this.searchVendors(dto.q) : Promise.resolve([]),
    ]);

    return { products, vendors, totalResults: products.length + vendors.length };
  }

  private shouldSearchProducts(type: string): boolean {
    return type === "products" || type === "all";
  }

  private shouldSearchVendors(type: string): boolean {
    return type === "vendors" || type === "all";
  }

  private searchProducts(text: string, category?: string): Promise<any[]> {
    const query: any = { $text: { $search: text } };
    if (category) query.category = category;

    return this.productModel
      .find(query, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .limit(SEARCH_RESULT_LIMIT)
      .lean();
  }

  private searchVendors(text: string): Promise<any[]> {
    return this.vendorModel
      .find({ $text: { $search: text } }, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .limit(SEARCH_RESULT_LIMIT)
      .lean();
  }
}
