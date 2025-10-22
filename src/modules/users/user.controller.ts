import {
  Body,
  Controller,
  Post,
  Get,
  UseGuards,
  Request,
} from "@nestjs/common";

import { UserService } from "./user.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { AuthGuard } from "../../common/guards/jwt-auth.guard";

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post("register")
  async register(@Body() createUserDto: CreateUserDto) {
    const result = await this.userService.createUser(createUserDto);
    return {
      success: true,
      message: "User registered successfully",
      ...result,
    };
  }

  // Add other endpoints without explicit return types
  @Post("login")
  async login(@Body() loginDto: any) {
    const result = await this.userService.loginUser(loginDto);
    return {
      success: true,
      message: "Login successful",
      ...result,
    };
  }

  @UseGuards(AuthGuard)
  @Get("profile")
  async getProfile(@Request() req) {
    const user = await this.userService.getUserProfile(req.user.sub);
    return {
      success: true,
      message: "Profile fetched successfully",
      user,
    };
  }

  @UseGuards(AuthGuard)
  @Post("change-password")
  async changePassword(@Request() req, @Body() changePasswordDto: any) {
    const result = await this.userService.changePassword(
      req.user.sub,
      changePasswordDto
    );
    return result;
  }

  @Post("forgot-password")
  async forgotPassword(@Body() forgotPasswordDto: any) {
    const result = await this.userService.forgotPassword(forgotPasswordDto);
    return result;
  }

  @Post("reset-password")
  async resetPassword(@Body() resetPasswordDto: any) {
    const result = await this.userService.resetPassword(resetPasswordDto);
    return result;
  }

  @UseGuards(AuthGuard)
  @Post("update-profile")
  async updateProfile(@Request() req, @Body() updateProfileDto: any) {
    const user = await this.userService.updateUser(
      req.user.sub,
      updateProfileDto
    );
    return {
      success: true,
      message: "Profile updated successfully",
      user,
    };
  }

  @UseGuards(AuthGuard)
  @Post("update-address")
  async updateAddress(@Request() req, @Body() updateAddressDto: any) {
    const addresses = await this.userService.updateAddress(
      req.user.sub,
      updateAddressDto
    );
    return {
      success: true,
      message: "Address updated successfully",
      addresses,
    };
  }

  @UseGuards(AuthGuard)
  @Post("update-payment-method")
  async updatePaymentMethod(@Request() req, @Body() updatePaymentMethodDto: any) {
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
}