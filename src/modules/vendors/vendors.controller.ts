import {
  Controller,
  Post,
  Body,
  Get,
  Request,
  UseGuards,
  Req,
} from "@nestjs/common";
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
import { ChangePasswordDto } from "../users/dto/change-password.dto";
import { ForgotPasswordDto } from "../users/dto/forgot-password.dto";
import { ResetPasswordDto } from "../users/dto/reset-password.dto";
import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { RefreshTokenGuard } from "src/common/guards/jwt-refresh.guard";

@ApiTags("Vendors")
@Controller("vendors")
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  // ✅ REGISTER
  @Post("register")
  @ApiOperation({ summary: "Register a new vendor account" })
  @ApiResponse({ status: 201, description: "Vendor registered successfully" })
  async register(@Body() dto: CreateVendorDto) {
    const result = await this.vendorService.createVendor(dto);
    return {
      success: true,
      message: "Vendor registered successfully",
      ...result,
    };
  }

  // ✅ LOGIN
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

  // ✅ GET PROFILE
  @UseGuards(AccessTokenGuard)
  @Get("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Fetch authenticated vendor profile" })
  @ApiResponse({ status: 200, description: "Profile fetched successfully" })
  async profile(@Request() req) {
    const vendor = await this.vendorService.getVendorProfile(req.user.sub);
    return { success: true, message: "Profile fetched", vendor };
  }

  // ✅ UPDATE PROFILE
  @UseGuards(AccessTokenGuard)
  @Post("update-profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor profile details" })
  @ApiResponse({ status: 200, description: "Profile updated successfully" })
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    const vendor = await this.vendorService.updateProfile(req.user.sub, dto);
    return { success: true, message: "Profile updated successfully", vendor };
  }

  // ✅ UPDATE LOCATION
  @UseGuards(AccessTokenGuard)
  @Post("update-location")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor location" })
  @ApiResponse({ status: 200, description: "Location updated successfully" })
  async updateLocation(@Request() req, @Body() dto: UpdateLocationDto) {
    const location = await this.vendorService.updateLocation(req.user.sub, dto);
    return { success: true, message: "Location updated successfully", location };
  }

  // ✅ UPDATE BUSINESS HOURS
  @UseGuards(AccessTokenGuard)
  @Post("update-business-hours")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor business hours" })
  @ApiResponse({ status: 200, description: "Business hours updated successfully" })
  async updateBusinessHours(@Request() req, @Body() dto: UpdateBusinessHoursDto) {
    const businessHours = await this.vendorService.updateBusinessHours(req.user.sub, dto);
    return { success: true, message: "Business hours updated successfully", businessHours };
  }

  // ✅ UPDATE BANK DETAILS
  @UseGuards(AccessTokenGuard)
  @Post("update-bank-details")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update vendor bank account details" })
  @ApiResponse({ status: 200, description: "Bank details updated successfully" })
  async updateBankDetails(@Request() req, @Body() dto: UpdateBankDetailsDto) {
    const bankDetails = await this.vendorService.updateBankDetails(req.user.sub, dto);
    return { success: true, message: "Bank details updated successfully", bankDetails };
  }

  // ✅ CHANGE PASSWORD
  @UseGuards(AccessTokenGuard)
  @Post("change-password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change vendor account password" })
  @ApiResponse({ status: 200, description: "Password changed successfully" })
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return await this.vendorService.changePassword(req.user.sub, dto);
  }

  // ✅ FORGOT PASSWORD
  @Post("forgot-password")
  @ApiOperation({ summary: "Send password reset link via email" })
  @ApiResponse({ status: 200, description: "Password reset email sent successfully" })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.vendorService.forgotPassword(dto);
  }

  // ✅ RESET PASSWORD
  @Post("reset-password")
  @ApiOperation({ summary: "Reset vendor password using token" })
  @ApiResponse({ status: 200, description: "Password reset successfully" })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.vendorService.resetPassword(dto);
  }

  // ✅ LOGOUT
  @UseGuards(AccessTokenGuard)
  @Post("logout")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Log out the authenticated vendor" })
  @ApiResponse({ status: 200, description: "Vendor logged out successfully" })
  async logout(@Request() req) {
    await this.vendorService.logOut(req.user.sub);
    return { success: true, message: "Logged out successfully" };
  }

  // ✅ REFRESH TOKENS
  @UseGuards(RefreshTokenGuard)
  @Post("refresh")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Refresh access and refresh tokens" })
  @ApiResponse({ status: 200, description: "Tokens refreshed successfully" })
  async refreshTokens(@Req() req) {
    const userId = req.user.sub;
    const refreshToken = req.user.refreshToken;
    const tokens = await this.vendorService.refreshTokens(userId, refreshToken);
    return { success: true, message: "Tokens refreshed successfully", tokens };
  }
}
