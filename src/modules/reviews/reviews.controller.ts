import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { RolesGuard } from "src/common/guards/roles.guard";
import { Roles } from "src/common/decorators/roles.decorator";

import { ReviewsService } from "./reviews.service";
import { CreateReviewDto } from "./dto/create-review.dto";
import { ReviewQueryDto } from "./dto/review-query.dto";

@ApiTags("Reviews")
@Controller("reviews")
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles("student")
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Review a completed order (Student only)" })
  @ApiResponse({ status: 201, description: "Review submitted successfully" })
  async createReview(@Request() req, @Body() dto: CreateReviewDto) {
    const result = await this.reviewsService.createReview(req.user.sub, dto);
    return { success: true, message: "Review submitted successfully", data: result };
  }

  @Get("vendor/:vendorId")
  @ApiOperation({ summary: "List reviews for a vendor" })
  @ApiResponse({ status: 200, description: "Reviews fetched successfully" })
  async listVendorReviews(@Param("vendorId") vendorId: string, @Query() query: ReviewQueryDto) {
    const result = await this.reviewsService.listVendorReviews(vendorId, query);
    return { success: true, message: "Reviews fetched successfully", data: result };
  }
}
