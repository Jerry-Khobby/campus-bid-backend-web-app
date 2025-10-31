import {
  Body,
  Controller,
  Post,
  Get,
  UseGuards,
  Request,
  Req,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from "@nestjs/swagger";

import { UserService } from "./user.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";
import { UpdatePaymentMethodDto } from "./dto/update-payment-method.dto";
import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { RefreshTokenGuard } from "src/common/guards/jwt-refresh.guard";
import { Roles } from "src/common/decorators/roles.decorator";
import { RolesGuard } from "src/common/guards/roles.guard";

@ApiTags("Users")
@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ✅ REGISTER
  @Post("register")
  @ApiOperation({ summary: "Register a new user account" })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: "User registered successfully" })
  async register(@Body() createUserDto: CreateUserDto) {
    const result = await this.userService.createUser(createUserDto);
    return {
      success: true,
      message: "User registered successfully",
      ...result,
    };
  }

  // ✅ LOGIN
  @Post("login")
  @ApiOperation({ summary: "Login user and return JWT tokens" })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: "Login successful" })
  async login(@Body() loginDto: LoginDto) {
    const result = await this.userService.loginUser(loginDto);
    return {
      success: true,
      message: "Login successful",
      ...result,
    };
  }

  // ✅ GET PROFILE
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Get("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get authenticated user profile (student)" })
  @ApiResponse({ status: 200, description: "Profile fetched successfully" })
  async getProfile(@Request() req) {
    const user = await this.userService.getUserProfile(req.user.sub);
    return {
      success: true,
      message: "Profile fetched successfully",
      user,
    };
  }

  // ✅ CHANGE PASSWORD
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("change-password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change user password (student)" })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: "Password updated successfully" })
  async changePassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto
  ) {
    return this.userService.changePassword(req.user.sub, changePasswordDto);
  }

  // ✅ FORGOT PASSWORD
  @Post("forgot-password")
  @ApiOperation({ summary: "Request password reset token" })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: "Reset token sent to email" })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.userService.forgotPassword(forgotPasswordDto);
  }

  // ✅ RESET PASSWORD
  @Post("reset-password")
  @ApiOperation({ summary: "Reset password using reset token" })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: "Password reset successfully" })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.userService.resetPassword(resetPasswordDto);
  }

  // ✅ UPDATE PROFILE
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("update-profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update user profile (student)" })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, description: "Profile updated successfully" })
  async updateProfile(
    @Request() req,
    @Body() updateProfileDto: UpdateProfileDto
  ) {
    const user = await this.userService.updateUser(req.user.sub, updateProfileDto);
    return {
      success: true,
      message: "Profile updated successfully",
      user,
    };
  }

  // ✅ UPDATE ADDRESS
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("update-address")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add or update user address (student)" })
  @ApiBody({ type: UpdateAddressDto })
  @ApiResponse({ status: 200, description: "Address updated successfully" })
  async updateAddress(@Request() req, @Body() updateAddressDto: UpdateAddressDto) {
    const addresses = await this.userService.updateAddress(req.user.sub, updateAddressDto);
    return {
      success: true,
      message: "Address updated successfully",
      addresses,
    };
  }

  // ✅ UPDATE PAYMENT METHOD
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("update-payment-method")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add or update user payment method (student)" })
  @ApiBody({ type: UpdatePaymentMethodDto })
  @ApiResponse({ status: 200, description: "Payment method updated successfully" })
  async updatePaymentMethod(
    @Request() req,
    @Body() updatePaymentMethodDto: UpdatePaymentMethodDto
  ) {
    const paymentMethods = await this.userService.updatePaymentMethod(
      req.user.sub,
      updatePaymentMethodDto
    );
    return {
      success: true,
      message: "Payment method updated successfully",
      paymentMethods,
    };
  }

  // ✅ LOGOUT
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Get("logout")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Log out the authenticated user (student)" })
  @ApiResponse({ status: 200, description: "User logged out successfully" })
  async logout(@Request() req) {
    await this.userService.logOut(req.user.sub);
    return { success: true, message: "Logged out successfully" };
  }

  // ✅ REFRESH TOKENS
  @UseGuards(RefreshTokenGuard)
  @Post("refresh")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Refresh expired access token" })
  @ApiResponse({ status: 200, description: "New tokens generated successfully" })
  async refreshTokens(@Req() req: any) {
    const userId = req.user.sub;
    const refreshToken = req.user.refreshToken;
    const tokens = await this.userService.refreshTokens(userId, refreshToken);
    return {
      success: true,
      message: "Tokens refreshed successfully",
      tokens,
    };
  }
}
