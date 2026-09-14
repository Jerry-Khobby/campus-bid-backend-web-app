import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { RolesGuard } from "src/common/guards/roles.guard";
import { Roles } from "src/common/decorators/roles.decorator";

import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

@ApiTags("Categories")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: "List active categories with product counts" })
  @ApiResponse({ status: 200, description: "Categories fetched successfully" })
  async listActive() {
    const categories = await this.categoriesService.listActive();
    return { success: true, message: "Categories fetched successfully", data: categories };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("admin")
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new category (Admin only)" })
  @ApiResponse({ status: 201, description: "Category created successfully" })
  async create(@Body() dto: CreateCategoryDto) {
    const category = await this.categoriesService.create(dto);
    return { success: true, message: "Category created successfully", data: category };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("admin")
  @Patch(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a category (Admin only)" })
  @ApiResponse({ status: 200, description: "Category updated successfully" })
  async update(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    const category = await this.categoriesService.update(id, dto);
    return { success: true, message: "Category updated successfully", data: category };
  }

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("admin")
  @Delete(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Deactivate a category (Admin only)" })
  @ApiResponse({ status: 200, description: "Category deactivated successfully" })
  async remove(@Param("id") id: string) {
    await this.categoriesService.remove(id);
    return { success: true, message: "Category deactivated successfully", data: null };
  }
}
