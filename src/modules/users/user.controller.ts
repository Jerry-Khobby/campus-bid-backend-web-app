import {
  Body,
  Controller,
  Post,
  Put,
  Delete,
  Param,
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
import { CreateAddressDto } from "./dto/create-address.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";
import { CreatePaymentMethodDto } from "./dto/create-payment-method.dto";
import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { RefreshTokenGuard } from "src/common/guards/jwt-refresh.guard";
import { Roles } from "src/common/decorators/roles.decorator";
import { RolesGuard } from "src/common/guards/roles.guard";
import { AuthGuard } from "@nestjs/passport";
import { CloudinaryService } from "../uploads/cloudinary.service";

import {FileInterceptor} from "@nestjs/platform-express";
import { UploadedFile,UseInterceptors } from "@nestjs/common";


@ApiTags("Users")
@Controller("users")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // ✅ REGISTER
  @Post("register")
  @UseInterceptors(FileInterceptor('profileImage'))
  @ApiOperation({ summary: "Register a new user account" })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: "User registered successfully" })
  async register(
    @UploadedFile() profileImage: Express.Multer.File,
    @Body() createUserDto: CreateUserDto) {
    const result = await this.userService.createUser(createUserDto,profileImage);
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
  @Put("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update user profile fields (student)" })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, description: "Profile updated successfully" })
  async updateProfile(@Request() req, @Body() updateProfileDto: UpdateProfileDto) {
    const user = await this.userService.updateUser(req.user.sub, updateProfileDto);
    return {
      success: true,
      message: "Profile updated successfully",
      user,
    };
  }

  // ✅ UPDATE PROFILE IMAGE
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("profile/image")
  @UseInterceptors(FileInterceptor("profileImage"))
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload/replace the user profile image (student)" })
  @ApiResponse({ status: 200, description: "Profile image updated successfully" })
  async updateProfileImage(
    @Request() req,
    @UploadedFile() profileImage: Express.Multer.File
  ) {
    const uploaded = await this.cloudinaryService.uploadImage(profileImage);
    const user = await this.userService.updateProfileImage(req.user.sub, uploaded.secure_url);

    return {
      success: true,
      message: "Profile image updated successfully",
      user,
    };
  }

  // ✅ GET ADDRESSES
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Get("addresses")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated user's addresses (student)" })
  @ApiResponse({ status: 200, description: "Addresses fetched successfully" })
  async getAddresses(@Request() req) {
    const addresses = await this.userService.getAddresses(req.user.sub);
    return {
      success: true,
      message: "Addresses fetched successfully",
      addresses,
    };
  }

  // ✅ ADD ADDRESS
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("addresses")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add a new user address (student)" })
  @ApiBody({ type: CreateAddressDto })
  @ApiResponse({ status: 200, description: "Address added successfully" })
  async addAddress(@Request() req, @Body() createAddressDto: CreateAddressDto) {
    const addresses = await this.userService.addAddress(req.user.sub, createAddressDto);
    return {
      success: true,
      message: "Address added successfully",
      addresses,
    };
  }

  // ✅ UPDATE ADDRESS
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Put("addresses/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update an existing user address (student)" })
  @ApiBody({ type: UpdateAddressDto })
  @ApiResponse({ status: 200, description: "Address updated successfully" })
  async updateAddress(
    @Request() req,
    @Param("id") addressId: string,
    @Body() updateAddressDto: UpdateAddressDto
  ) {
    const addresses = await this.userService.updateAddress(
      req.user.sub,
      addressId,
      updateAddressDto
    );
    return {
      success: true,
      message: "Address updated successfully",
      addresses,
    };
  }

  // ✅ DELETE ADDRESS
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Delete("addresses/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a user address (student)" })
  @ApiResponse({ status: 200, description: "Address deleted successfully" })
  async deleteAddress(@Request() req, @Param("id") addressId: string) {
    const addresses = await this.userService.deleteAddress(req.user.sub, addressId);
    return {
      success: true,
      message: "Address deleted successfully",
      addresses,
    };
  }

  // ✅ GET PAYMENT METHODS
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Get("payment-methods")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated user's payment methods (student)" })
  @ApiResponse({ status: 200, description: "Payment methods fetched successfully" })
  async getPaymentMethods(@Request() req) {
    const paymentMethods = await this.userService.getPaymentMethods(req.user.sub);
    return {
      success: true,
      message: "Payment methods fetched successfully",
      paymentMethods,
    };
  }

  // ✅ ADD PAYMENT METHOD
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("payment-methods")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add a new user payment method (student)" })
  @ApiBody({ type: CreatePaymentMethodDto })
  @ApiResponse({ status: 200, description: "Payment method added successfully" })
  async addPaymentMethod(
    @Request() req,
    @Body() createPaymentMethodDto: CreatePaymentMethodDto
  ) {
    const paymentMethods = await this.userService.addPaymentMethod(
      req.user.sub,
      createPaymentMethodDto
    );
    return {
      success: true,
      message: "Payment method added successfully",
      paymentMethods,
    };
  }

  // ✅ DELETE PAYMENT METHOD
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Delete("payment-methods/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a user payment method (student)" })
  @ApiResponse({ status: 200, description: "Payment method deleted successfully" })
  async deletePaymentMethod(@Request() req, @Param("id") paymentMethodId: string) {
    const paymentMethods = await this.userService.deletePaymentMethod(
      req.user.sub,
      paymentMethodId
    );
    return {
      success: true,
      message: "Payment method deleted successfully",
      paymentMethods,
    };
  }

  // ✅ LOGOUT
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post("logout")
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
@UseGuards(AuthGuard('google'))
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
@UseGuards(AuthGuard('google'))
async googleCallback(@Req() req) {
  // req.user comes from GoogleStrategy.validate()
  return this.userService.handleGoogleLogin(req.user);
}

}
