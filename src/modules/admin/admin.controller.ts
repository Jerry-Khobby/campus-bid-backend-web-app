import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { RolesGuard } from "src/common/guards/roles.guard";
import { Roles } from "src/common/decorators/roles.decorator";
import { AdminService } from "./admin.service";

@ApiTags("Admin")
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles("admin")
@ApiBearerAuth()
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Platform-wide dashboard overview (Admin only)" })
  async getDashboard() {
    const data = await this.adminService.getDashboard();
    return { success: true, message: "Dashboard fetched successfully", data };
  }

  @Get("analytics")
  @ApiOperation({ summary: "Platform-wide analytics (Admin only)" })
  async getAnalytics() {
    const data = await this.adminService.getAnalytics();
    return { success: true, message: "Analytics fetched successfully", data };
  }
}
