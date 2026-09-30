import {
  Controller,
  Post,
  Put,
  Patch,
  Body,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ConfigService } from "@nestjs/config";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { VendorService } from "./vendors.service";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { VendorLoginDto } from "./dto/vendor-login.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateBankDetailsDto } from "./dto/update-bank-details.dto";
import { UpdateBusinessHoursDto } from "./dto/update-business-hours.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { VendorQueryDto } from "./dto/vendor-query.dto";
import { AdminVendorQueryDto } from "./dto/admin-vendor-query.dto";
import { VendorSalesAnalyticsQueryDto } from "./dto/vendor-sales-analytics-query.dto";
import { VendorProductAnalyticsQueryDto } from "./dto/vendor-product-analytics-query.dto";
import { ChangePasswordDto } from "../users/dto/change-password.dto";
import { ForgotPasswordDto } from "../users/dto/forgot-password.dto";
import { ResetPasswordDto } from "../users/dto/reset-password.dto";
import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { RefreshTokenGuard } from "src/common/guards/jwt-refresh.guard";
import { Roles } from "src/common/decorators/roles.decorator";
import { RolesGuard } from "src/common/guards/roles.guard";
import {FileInterceptor} from "@nestjs/platform-express";
import { UploadedFile,UseInterceptors } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { CloudinaryService } from "../uploads/cloudinary.service";
import { FilterProductDto } from "../products/dto/filter-product.dto";
import { ProductsService } from "../products/products.service";
import { FlashSaleService } from "../flash-sales/flash-sale.service";
import { VendorFlashSaleQueryDto } from "../flash-sales/dto/vendor-flash-sale-query.dto";
import { OrdersService } from "../orders/orders.service";
import { OrderQueryDto } from "../orders/dto/order-query.dto";
import { PayoutsService } from "../payments/payouts.service";

@ApiTags("Vendors")
@Controller("vendors")
export class VendorController {
  constructor(
    private readonly vendorService: VendorService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly productsService: ProductsService,
    private readonly flashSaleService: FlashSaleService,
    private readonly ordersService: OrdersService,
    private readonly payoutsService: PayoutsService,
    private readonly configService: ConfigService,
  ) {}

  // ✅ REGISTER (Public)
  @Post("register")
    @UseInterceptors(FileInterceptor('logo'))
  @ApiOperation({ summary: "Register a new vendor account" })
  @ApiResponse({ status: 201, description: "Vendor registered successfully" })
  async register(
    @UploadedFile() logo: Express.Multer.File,
    @Body() dto: CreateVendorDto) {
    const result = await this.vendorService.createVendor(dto,logo);
    return {
      success: true,
      message: "Vendor registered successfully",
      ...result,
    };
  }

  // ✅ LOGIN (Public)
  @Post("login")
  @ApiOperation({ summary: "Authenticate vendor and return tokens" })
  @ApiResponse({ status: 200, description: "Login successful" })
  async login(@Body() dto: VendorLoginDto) {
    const result = await this.vendorService.loginVendor(dto);
    return {
      success: true,
      message: "Login successful",
      ...result,
    };
  }

  // ✅ LIST VENDORS (Public discovery)
  @Get()
  @ApiOperation({ summary: "Browse/search vendors (public)" })
  async listVendors(@Query() query: VendorQueryDto) {
    const data = await this.vendorService.listVendors(query);
    return { success: true, message: "Vendors fetched successfully", data };
  }

  // ✅ GET PROFILE (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Fetch authenticated vendor profile" })
  async profile(@Request() req) {
    const vendor = await this.vendorService.getVendorProfile(req.user.sub);
    return { success: true, message: "Profile fetched", vendor };
  }

  // ✅ UPDATE PROFILE (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Put("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor profile details" })
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    const vendor = await this.vendorService.updateProfile(req.user.sub, dto);
    return { success: true, message: "Profile updated successfully", vendor };
  }

  // ✅ UPDATE LOGO (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @UseInterceptors(FileInterceptor("logo"))
  @Post("profile/logo")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload/replace vendor logo" })
  async updateLogo(@Request() req, @UploadedFile() logo: Express.Multer.File) {
    const uploaded = await this.cloudinaryService.uploadImage(logo);
    const data = await this.vendorService.updateLogo(req.user.sub, uploaded.secure_url);
    return { success: true, message: "Logo updated successfully", data };
  }

  // ✅ UPDATE BANNER (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @UseInterceptors(FileInterceptor("banner"))
  @Post("profile/banner")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload/replace vendor banner" })
  async updateBanner(@Request() req, @UploadedFile() banner: Express.Multer.File) {
    const uploaded = await this.cloudinaryService.uploadImage(banner);
    const data = await this.vendorService.updateBanner(req.user.sub, uploaded.secure_url);
    return { success: true, message: "Banner updated successfully", data };
  }

  // ✅ UPDATE LOCATION (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("update-location")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor location" })
  async updateLocation(@Request() req, @Body() dto: UpdateLocationDto) {
    const location = await this.vendorService.updateLocation(req.user.sub, dto);
    return { success: true, message: "Location updated successfully", location };
  }

  // ✅ UPDATE BUSINESS HOURS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("update-business-hours")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor business hours" })
  async updateBusinessHours(@Request() req, @Body() dto: UpdateBusinessHoursDto) {
    const businessHours = await this.vendorService.updateBusinessHours(req.user.sub, dto);
    return { success: true, message: "Business hours updated successfully", businessHours };
  }

  // ✅ UPDATE BANK DETAILS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Put("bank-details")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor bank account details" })
  async updateBankDetails(@Request() req, @Body() dto: UpdateBankDetailsDto) {
    const bankDetails = await this.vendorService.updateBankDetails(req.user.sub, dto);
    return { success: true, message: "Bank details updated successfully", bankDetails };
  }

  // ✅ CHANGE PASSWORD (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("change-password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change vendor account password" })
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return await this.vendorService.changePassword(req.user.sub, dto);
  }

  // ✅ FORGOT PASSWORD (Public)
  @Post("forgot-password")
  @ApiOperation({ summary: "Send password reset link via email" })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.vendorService.forgotPassword(dto);
  }

  // ✅ RESET PASSWORD (Public)
  @Post("reset-password")
  @ApiOperation({ summary: "Reset vendor password using token" })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.vendorService.resetPassword(dto);
  }

  // ✅ LOGOUT (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("logout")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Log out the authenticated vendor" })
  async logout(@Request() req) {
    await this.vendorService.logOut(req.user.sub);
    return { success: true, message: "Logged out successfully" };
  }

  // ✅ REFRESH TOKENS (Vendor only)
  @UseGuards(RefreshTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("refresh")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Refresh access and refresh tokens" })
  async refreshTokens(@Req() req) {
    const userId = req.user.sub;
    const refreshToken = req.user.refreshToken;
    const tokens = await this.vendorService.refreshTokens(userId, refreshToken);
    return { success: true, message: "Tokens refreshed successfully", tokens };
  }

  // ✅ MY PRODUCTS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("products")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated vendor's products" })
  async getMyProducts(@Request() req, @Query() query: FilterProductDto) {
    const data = await this.productsService.listProducts({ ...query, vendorId: req.user.sub });
    return { success: true, message: "Products fetched successfully", data };
  }

  // ✅ MY FLASH SALES (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("flash-sales")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated vendor's flash sales" })
  async getMyFlashSales(@Request() req, @Query() query: VendorFlashSaleQueryDto) {
    const data = await this.flashSaleService.getVendorFlashSales(req.user.sub, query);
    return { success: true, message: "Flash sales fetched successfully", data };
  }

  // ✅ MY ORDERS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("orders")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated vendor's orders" })
  async getMyOrders(@Request() req, @Query() query: OrderQueryDto) {
    const data = await this.ordersService.getOrders(req.user.sub, "vendor", query);
    return { success: true, message: "Orders fetched successfully", data };
  }

  // ✅ MY ORDER BY ID (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("orders/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Fetch one of the authenticated vendor's orders" })
  async getMyOrderById(@Request() req, @Param("id") id: string) {
    const data = await this.ordersService.getOrderById(id, req.user.sub, "vendor");
    return { success: true, message: "Order fetched successfully", data };
  }

  // ✅ LIST PAYOUTS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("payouts")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List payout requests for the authenticated vendor" })
  async getPayouts(@Request() req) {
    const data = await this.payoutsService.listPayouts(req.user.sub);
    return { success: true, message: "Payouts fetched successfully", data };
  }

  // ✅ REQUEST PAYOUT (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Post("payouts/request")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Request a payout of the available balance" })
  async requestPayout(@Request() req) {
    const data = await this.payoutsService.requestPayout(req.user.sub);
    return { success: true, message: "Payout requested successfully", data };
  }

  // ✅ HELD PAYMENTS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("payouts/held-payments")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List held payments contributing to the pending balance" })
  async getHeldPayments(@Request() req) {
    const data = await this.payoutsService.getHeldPayments(req.user.sub);
    return { success: true, message: "Held payments fetched successfully", data };
  }

  // ✅ DASHBOARD (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("dashboard")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Fetch the authenticated vendor's dashboard summary" })
  async getDashboard(@Request() req) {
    const data = await this.vendorService.getDashboard(req.user.sub);
    return { success: true, message: "Dashboard fetched successfully", data };
  }

  // ✅ SALES ANALYTICS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("analytics/sales")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Fetch the authenticated vendor's sales analytics" })
  async getSalesAnalytics(@Request() req, @Query() query: VendorSalesAnalyticsQueryDto) {
    const data = await this.vendorService.getSalesAnalytics(req.user.sub, query);
    return { success: true, message: "Sales analytics fetched successfully", data };
  }

  // ✅ PRODUCT ANALYTICS (Vendor only)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("vendor")
  @Get("analytics/products")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Fetch the authenticated vendor's product analytics" })
  async getProductAnalytics(@Request() req, @Query() query: VendorProductAnalyticsQueryDto) {
    const data = await this.vendorService.getProductAnalytics(req.user.sub, query);
    return { success: true, message: "Product analytics fetched successfully", data };
  }

  // ✅ VENDOR PRODUCTS (Public)
  @Get(":id/products")
  @ApiOperation({ summary: "List a vendor's products (public)" })
  async getVendorProducts(@Param("id") id: string, @Query() query: FilterProductDto) {
    const data = await this.productsService.listProducts({ ...query, vendorId: id });
    return { success: true, message: "Products fetched successfully", data };
  }

  // Redirects user to Google
  @ApiOperation({
    summary: 'Login / Register with Google',
    description: 'Redirects the user to Google OAuth consent screen',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Google OAuth',
  })
  @Get('google')
  @UseGuards(AuthGuard('google-vendor'))
  googleAuth() {
    // Passport handles redirect automatically
  }


    // Google redirects back here
  @ApiOperation({
    summary: 'Google OAuth callback',
    description: 'Handles Google response and returns JWT tokens',
  })
  @ApiResponse({
    status: 200,
    description: 'Google login successful',
    schema: {
      example: {
        success: true,
        user: {
          email: 'user@gmail.com',
          role: 'student',
        },
        accessToken: 'jwt-access-token',
        refreshToken: 'jwt-refresh-token',
      },
    },
  })
  @Get('google/callback')
  @UseGuards(AuthGuard('google-vendor'))
  async googleCallback(@Req() req, @Res() res: Response) {
    // req.user comes from GoogleStrategy.validate(). The browser is
    // mid-redirect from Google, so it can't read a JSON response here — hand
    // the outcome off via a redirect to a frontend page that stores the
    // tokens (or shows the error) instead of throwing straight to the user.
    const appUrl = this.configService.get<string>('VENDOR_APP_URL') ?? 'http://localhost:5002';

    try {
      const { accessToken, refreshToken } = await this.vendorService.handleGoogleLogin(req.user);
      res.redirect(`${appUrl}/auth/google/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google login failed';
      const email = req.user?.email ? `&email=${encodeURIComponent(req.user.email)}` : '';
      res.redirect(`${appUrl}/auth/google/callback?error=${encodeURIComponent(message)}${email}`);
    }
  }

  // ✅ ADMIN — list every vendor regardless of approval/active state
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("admin")
  @Get("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all vendors, including pending/suspended (Admin only)" })
  async listVendorsForAdmin(@Query() query: AdminVendorQueryDto) {
    const data = await this.vendorService.listAllVendorsForAdmin(query);
    return { success: true, message: "Vendors fetched successfully", data };
  }

  // ✅ ADMIN — approve a pending vendor, making it publicly visible
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("admin")
  @Patch(":id/approve")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Approve a vendor (Admin only)" })
  async approveVendor(@Param("id") id: string) {
    const vendor = await this.vendorService.approveVendor(id);
    return { success: true, message: "Vendor approved successfully", vendor };
  }

  // ✅ ADMIN — suspend a vendor, hiding it from public discovery
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("admin")
  @Patch(":id/suspend")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Suspend a vendor (Admin only)" })
  async suspendVendor(@Param("id") id: string) {
    const vendor = await this.vendorService.suspendVendor(id);
    return { success: true, message: "Vendor suspended successfully", vendor };
  }

  // ✅ VENDOR PUBLIC PROFILE (Public) — must stay last: catches any single-segment /vendors/:id path
  @Get(":id")
  @ApiOperation({ summary: "Fetch a vendor's public profile" })
  async getVendorById(@Param("id") id: string) {
    const vendor = await this.vendorService.getPublicVendorById(id);
    return { success: true, message: "Vendor fetched successfully", vendor };
  }
}
