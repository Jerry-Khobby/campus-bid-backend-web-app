import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { SearchService } from "./search.service";
import { SearchQueryDto } from "./dto/search-query.dto";

@ApiTags("Search")
@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: "Search products and vendors" })
  @ApiResponse({ status: 200, description: "Search results fetched successfully" })
  async search(@Query() query: SearchQueryDto) {
    const result = await this.searchService.search(query);
    return { success: true, message: "Search results fetched successfully", data: result };
  }
}
