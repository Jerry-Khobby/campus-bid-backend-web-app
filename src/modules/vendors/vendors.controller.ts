import {
  Controller,
  Post,
  Body,
  Get,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
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
import { AuthGuard } from "src/common/guards/jwt-auth.guard";

@ApiTags("Vendors")
@Controller("vendors")
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  // ✅ REGISTER
  @Post("register")
  @ApiOperation({ summary: "Register new vendor" })
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
  @ApiOperation({ summary: "Vendor login" })
  async login(@Body() dto: VendorLoginDto) {
    const result = await this.vendorService.loginVendor(dto);
    return {
      success: true,
      message: "Login successful",
      ...result,
    };
  }

  // ✅ PROFILE
  @UseGuards(AuthGuard)
  @Get("profile")
  @ApiBearerAuth()
  async profile(@Request() req) {
    const vendor = await this.vendorService.getVendorProfile(req.user.sub);
    return { success: true, message: "Profile fetched", vendor };
  }

  // ✅ UPDATE PROFILE
  @UseGuards(AuthGuard)
  @Post("update-profile")
  @ApiBearerAuth()
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    const vendor = await this.vendorService.updateProfile(req.user.sub, dto);
    return { success: true, message: "Profile updated", vendor };
  }

  // ✅ UPDATE LOCATION
  @UseGuards(AuthGuard)
  @Post("update-location")
  @ApiBearerAuth()
  async updateLocation(@Request() req, @Body() dto: UpdateLocationDto) {
    const location = await this.vendorService.updateLocation(req.user.sub, dto);
    return { success: true, message: "Location updated", location };
  }

  // ✅ UPDATE BUSINESS HOURS
  @UseGuards(AuthGuard)
  @Post("update-business-hours")
  @ApiBearerAuth()
  async updateBusinessHours(@Request() req, @Body() dto: UpdateBusinessHoursDto) {
    const businessHours = await this.vendorService.updateBusinessHours(req.user.sub, dto);
    return { success: true, message: "Business hours updated", businessHours };
  }

  // ✅ UPDATE BANK DETAILS
  @UseGuards(AuthGuard)
  @Post("update-bank-details")
  @ApiBearerAuth()
  async updateBankDetails(@Request() req, @Body() dto: UpdateBankDetailsDto) {
    const bankDetails = await this.vendorService.updateBankDetails(req.user.sub, dto);
    return { success: true, message: "Bank details updated", bankDetails };
  }

  // ✅ CHANGE PASSWORD
  @UseGuards(AuthGuard)
  @Post("change-password")
  @ApiBearerAuth()
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return await this.vendorService.changePassword(req.user.sub, dto);
  }

  // ✅ FORGOT PASSWORD
  @Post("forgot-password")
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.vendorService.forgotPassword(dto);
  }

  // ✅ RESET PASSWORD
  @Post("reset-password")
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.vendorService.resetPassword(dto);
  }
}
