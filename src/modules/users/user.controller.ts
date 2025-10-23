import {
  Body,
  Controller,
  Post,
  Get,
  UseGuards,
  Request,
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
import { AuthGuard } from "../../common/guards/jwt-auth.guard";
import { SafeUser } from "./user.service";

@ApiTags("Users") // 📘 Groups all endpoints under 'Users' in Swagger
@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ✅ REGISTER
  @Post("register")
  @ApiOperation({ summary: "Register a new user account" })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: "User registered successfully",
    schema: {
      example: {
        success: true,
        message: "User registered successfully",
        user: {
          _id: "abc123",
          email: "user@example.com",
          role: "user",
          profile: {},
          isVerified: false,
        },
        token: "jwt.token.here",
      },
    },
  })
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
  @ApiOperation({ summary: "Login user and return JWT token" })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: "Login successful",
    schema: {
      example: {
        success: true,
        message: "Login successful",
        user: {
          _id: "abc123",
          email: "user@example.com",
          role: "user",
          profile: {},
        },
        token: "jwt.token.here",
      },
    },
  })
  async login(@Body() loginDto: LoginDto) {
    const result = await this.userService.loginUser(loginDto);
    return {
      success: true,
      message: "Login successful",
      ...result,
    };
  }

  // ✅ GET PROFILE
  @UseGuards(AuthGuard)
  @Get("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get authenticated user profile" })
  @ApiResponse({
    status: 200,
    description: "Profile fetched successfully",
    type: Object,
    schema: {
      example: {
        success: true,
        message: "Profile fetched successfully",
        user: {
          _id: "abc123",
          email: "user@example.com",
          role: "user",
          profile: {},
          isVerified: true,
        },
      },
    },
  })
  async getProfile(@Request() req) {
    const user = await this.userService.getUserProfile(req.user.sub);
    return {
      success: true,
      message: "Profile fetched successfully",
      user,
    };
  }

  // ✅ CHANGE PASSWORD
  @UseGuards(AuthGuard)
  @Post("change-password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Change user password" })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: "Password updated successfully",
    schema: {
      example: { success: true, message: "Password updated successfully" },
    },
  })
  async changePassword(@Request() req, @Body() changePasswordDto: ChangePasswordDto) {
    const result = await this.userService.changePassword(
      req.user.sub,
      changePasswordDto
    );
    return result;
  }

  // ✅ FORGOT PASSWORD
  @Post("forgot-password")
  @ApiOperation({ summary: "Request password reset token" })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description: "Reset token sent to email",
    schema: {
      example: {
        success: true,
        message: "Password reset link sent to your email",
      },
    },
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    const result = await this.userService.forgotPassword(forgotPasswordDto);
    return result;
  }

  // ✅ RESET PASSWORD
  @Post("reset-password")
  @ApiOperation({ summary: "Reset password using reset token" })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: "Password reset successfully",
    schema: {
      example: {
        success: true,
        message: "Password has been reset successfully",
      },
    },
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    const result = await this.userService.resetPassword(resetPasswordDto);
    return result;
  }

  // ✅ UPDATE PROFILE
  @UseGuards(AuthGuard)
  @Post("update-profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update user profile" })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({
    status: 200,
    description: "Profile updated successfully",
    schema: {
      example: {
        success: true,
        message: "Profile updated successfully",
        user: {
          email: "user@example.com",
          profile: { name: "John Doe", avatar: "url" },
        },
      },
    },
  })
  async updateProfile(@Request() req, @Body() updateProfileDto: UpdateProfileDto) {
    const user = await this.userService.updateUser(req.user.sub, updateProfileDto);
    return {
      success: true,
      message: "Profile updated successfully",
      user,
    };
  }

  // ✅ UPDATE ADDRESS
  @UseGuards(AuthGuard)
  @Post("update-address")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add or update user address" })
  @ApiBody({ type: UpdateAddressDto })
  @ApiResponse({
    status: 200,
    description: "Address updated successfully",
    schema: {
      example: {
        success: true,
        message: "Address updated successfully",
        addresses: [
          { label: "Home", city: "Accra", country: "Ghana" },
        ],
      },
    },
  })
  async updateAddress(@Request() req, @Body() updateAddressDto: UpdateAddressDto) {
    const addresses = await this.userService.updateAddress(req.user.sub, updateAddressDto);
    return {
      success: true,
      message: "Address updated successfully",
      addresses,
    };
  }

  // ✅ UPDATE PAYMENT METHOD
  @UseGuards(AuthGuard)
  @Post("update-payment-method")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add or update user payment method" })
  @ApiBody({ type: UpdatePaymentMethodDto })
  @ApiResponse({
    status: 200,
    description: "Payment method updated successfully",
    schema: {
      example: {
        success: true,
        message: "Payment method updated successfully",
        paymentMethods: [
          { type: "Card", last4: "1234", provider: "Visa" },
        ],
      },
    },
  })
  async updatePaymentMethod(@Request() req, @Body() updatePaymentMethodDto: UpdatePaymentMethodDto) {
    const paymentMethods = await this.userService.updatePaymentMethod(req.user.sub, updatePaymentMethodDto);
    return {
      success: true,
      message: "Payment method updated successfully",
      paymentMethods,
    };
  }
}
