import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Delete,
  Patch,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateStockDto } from "./dto/update-stock.dto";
import { UpdatePriceDto } from "./dto/update-price.dto";
import { FilterProductDto } from "./dto/filter-product.dto";
import { ProductRatingDto } from "./dto/product-rating.dto";
import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";

@ApiTags("Products")
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // ✅ CREATE PRODUCT (Vendor only)
  @UseGuards(AccessTokenGuard)
  @Post("create")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new product (Vendor only)" })
  @ApiResponse({ status: 201, description: "Product created successfully" })
  async createProduct(@Request() req, @Body() dto: CreateProductDto) {
    dto.vendorId = req.user.sub;
    const result = await this.productsService.createProduct(dto);
    return { success: true, message: "Product created successfully", ...result };
  }

  // ✅ UPDATE PRODUCT (Vendor only)
  @UseGuards(AccessTokenGuard)
  @Patch(":id/update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update an existing product (Vendor only)" })
  @ApiResponse({ status: 200, description: "Product updated successfully" })
  async updateProduct(
    @Param("id") productId: string,
    @Request() req,
    @Body() dto: UpdateProductDto
  ) {
    const product = await this.productsService.updateProduct(productId, req.user.sub, dto);
    return { success: true, message: "Product updated successfully", product };
  }

  // ✅ GET SINGLE PRODUCT
  @Get(":id")
  @ApiOperation({ summary: "Get product by ID" })
  @ApiResponse({ status: 200, description: "Product fetched successfully" })
  async getProduct(@Param("id") productId: string) {
    const product = await this.productsService.getProductById(productId);
    return { success: true, message: "Product fetched successfully", product };
  }

  // ✅ LIST / FILTER / PAGINATE PRODUCTS
  @Get()
  @ApiOperation({ summary: "List or search products with filters" })
  @ApiResponse({ status: 200, description: "Products fetched successfully" })
  async listProducts(@Query() filter: FilterProductDto) {
    const data = await this.productsService.listProducts(filter);
    return { success: true, message: "Products fetched successfully", ...data };
  }

  // ✅ UPDATE STOCK (Vendor only)
  @UseGuards(AccessTokenGuard)
  @Post("update-stock")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update product stock (Vendor only)" })
  @ApiResponse({ status: 200, description: "Stock updated successfully" })
  async updateStock(@Request() req, @Body() dto: UpdateStockDto) {
    const result = await this.productsService.updateStock(dto, req.user.sub);
    return { success: true, message: "Stock updated successfully", ...result };
  }

  // ✅ UPDATE PRICE (Vendor only)
  @UseGuards(AccessTokenGuard)
  @Post("update-price")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update product price (Vendor only)" })
  @ApiResponse({ status: 200, description: "Price updated successfully" })
  async updatePrice(@Request() req, @Body() dto: UpdatePriceDto) {
    const result = await this.productsService.updatePrice(dto, req.user.sub);
    return { success: true, message: "Price updated successfully", ...result };
  }

  // ✅ RATE PRODUCT
  @Post("rate")
  @ApiOperation({ summary: "Rate a product (1–5 stars)" })
  @ApiResponse({ status: 200, description: "Product rated successfully" })
  async rateProduct(@Body() dto: ProductRatingDto) {
    const result = await this.productsService.rateProduct(dto);
    return { success: true, message: "Product rated successfully", ...result };
  }

  // ✅ DELETE PRODUCT (Vendor only)
  @UseGuards(AccessTokenGuard)
  @Delete(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete product (Vendor only)" })
  @ApiResponse({ status: 200, description: "Product deleted successfully" })
  async deleteProduct(@Param("id") productId: string, @Request() req) {
    await this.productsService.deleteProduct(productId, req.user.sub);
    return { success: true, message: "Product deleted successfully" };
  }
}
