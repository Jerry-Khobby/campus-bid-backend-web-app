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

}