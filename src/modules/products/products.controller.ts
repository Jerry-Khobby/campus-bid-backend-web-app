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
  UseInterceptors,
  UploadedFiles,
  Request,
  BadRequestException,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from "@nestjs/swagger";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateStockDto } from "./dto/update-stock.dto";
import { UpdatePriceDto } from "./dto/update-price.dto";
import { UpdateAvailabilityDto } from "./dto/update-availability.dto";
import { FilterProductDto } from "./dto/filter-product.dto";
import { NearbyQueryDto } from "./dto/nearby-query.dto";
import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { Roles } from "src/common/decorators/roles.decorator";
import { RolesGuard } from "src/common/guards/roles.guard";
import { CloudinaryService } from "../uploads/cloudinary.service";
import { IMAGE_UPLOAD_OPTIONS, MAX_IMAGES_PER_REQUEST } from "src/common/uploads/image-upload.options";

@ApiTags("Products")
@Controller("products")
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly cloudinaryService: CloudinaryService
  ) {}

  // ✅ CREATE PRODUCT (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("create")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new product (Vendor only)" })
  @ApiResponse({ status: 201, description: "Product created successfully" })
  async createProduct(@Request() req, @Body() dto: CreateProductDto) {
    const result = await this.productsService.createProduct(dto, req.user.sub);
    return { success: true, message: "Product created successfully", ...result };
  }

  // ✅ UPDATE PRODUCT (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Patch(":id/update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update an existing product (Vendor only)" })
  @ApiResponse({ status: 200, description: "Product updated successfully" })
  async updateProduct(
    @Param("id") productId: string,
    @Request() req,
    @Body() dto: UpdateProductDto
  ) {
    const product = await this.productsService.updateProduct(
      productId,
      req.user.sub,
      dto
    );
    return { success: true, message: "Product updated successfully", product };
  }

  // ✅ NEARBY PRODUCTS (Public) — must be declared before GET :id
  @Get("nearby")
  @ApiOperation({ summary: "Find products from vendors near a location" })
  @ApiResponse({ status: 200, description: "Nearby products fetched successfully" })
  async getNearbyProducts(@Query() query: NearbyQueryDto) {
    const data = await this.productsService.getNearbyProducts(query);
    return { success: true, message: "Nearby products fetched successfully", ...data };
  }

  // ✅ GET SINGLE PRODUCT (Public)
  @Get(":id")
  @ApiOperation({ summary: "Get product by ID" })
  @ApiResponse({ status: 200, description: "Product fetched successfully" })
  async getProduct(@Param("id") productId: string) {
    const product = await this.productsService.getProductById(productId);
    return { success: true, message: "Product fetched successfully", product };
  }

  // ✅ LIST / FILTER / PAGINATE PRODUCTS (Public)
  @Get()
  @ApiOperation({ summary: "List or search products with filters" })
  @ApiResponse({ status: 200, description: "Products fetched successfully" })
  async listProducts(@Query() filter: FilterProductDto) {
    const data = await this.productsService.listProducts(filter);
    return { success: true, message: "Products fetched successfully", ...data };
  }

  // ✅ UPDATE STOCK (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Patch(":id/stock")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update product stock (Vendor only)" })
  @ApiResponse({ status: 200, description: "Stock updated successfully" })
  async updateStock(
    @Param("id") productId: string,
    @Request() req,
    @Body() dto: UpdateStockDto
  ) {
    const result = await this.productsService.updateStock(productId, req.user.sub, dto);
    return { success: true, message: "Stock updated successfully", ...result };
  }

  // ✅ UPDATE PRICE (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("update-price")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update product price (Vendor only)" })
  @ApiResponse({ status: 200, description: "Price updated successfully" })
  async updatePrice(@Request() req, @Body() dto: UpdatePriceDto) {
    const result = await this.productsService.updatePrice(dto, req.user.sub);
    return { success: true, message: "Price updated successfully", ...result };
  }

  // ✅ UPDATE AVAILABILITY (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Patch(":id/availability")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update product availability (Vendor only)" })
  @ApiResponse({ status: 200, description: "Availability updated successfully" })
  async updateAvailability(
    @Param("id") productId: string,
    @Request() req,
    @Body() dto: UpdateAvailabilityDto
  ) {
    const product = await this.productsService.updateAvailability(productId, req.user.sub, dto);
    return { success: true, message: "Availability updated successfully", product };
  }

  // ✅ ADD PRODUCT IMAGES (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post(":id/images")
  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FilesInterceptor("images", MAX_IMAGES_PER_REQUEST, IMAGE_UPLOAD_OPTIONS))
  @ApiOperation({ summary: "Add images to an existing product (Vendor only)" })
  @ApiResponse({ status: 200, description: "Images added successfully" })
  async addProductImages(
    @Param("id") productId: string,
    @Request() req,
    @UploadedFiles() images: Express.Multer.File[]
  ) {
    if (!images?.length) throw new BadRequestException("No image files provided");

    await this.productsService.assertVendorOwnsProduct(productId, req.user.sub);
    const urls = await this.uploadImages(images);
    const result = await this.productsService.addProductImages(productId, req.user.sub, urls);
    return { success: true, message: "Images added successfully", images: result };
  }

  // ✅ DELETE PRODUCT (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Delete(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete product (Vendor only)" })
  @ApiResponse({ status: 200, description: "Product deleted successfully" })
  async deleteProduct(@Param("id") productId: string, @Request() req) {
    await this.productsService.deleteProduct(productId, req.user.sub);
    return { success: true, message: "Product deleted successfully" };
  }

  private async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    const uploads = await Promise.all(files.map((file) => this.cloudinaryService.uploadImage(file)));
    return uploads.map((result: any) => result.secure_url);
  }
}
