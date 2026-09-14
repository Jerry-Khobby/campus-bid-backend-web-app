import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { BadRequestException } from "@nestjs/common";

import { SearchService } from "./search.service";

describe("SearchService", () => {
  let service: SearchService;
  let productModel: any;
  let vendorModel: any;

  const buildQueryChain = (result: any[]) => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  beforeEach(async () => {
    productModel = { find: jest.fn() };
    vendorModel = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: getModelToken("Product"), useValue: productModel },
        { provide: getModelToken("Vendor"), useValue: vendorModel },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it("throws BadRequestException when q is missing", async () => {
    await expect(service.search({} as any)).rejects.toThrow(BadRequestException);
  });

  it("searches both products and vendors by default", async () => {
    productModel.find.mockReturnValue(buildQueryChain([{ name: "Chicken" }]));
    vendorModel.find.mockReturnValue(buildQueryChain([{ profile: { businessName: "Chick Hut" } }]));

    const result = await service.search({ q: "chicken" } as any);

    expect(result.totalResults).toBe(2);
    expect(productModel.find).toHaveBeenCalled();
    expect(vendorModel.find).toHaveBeenCalled();
  });

  it("only searches products when type is products", async () => {
    productModel.find.mockReturnValue(buildQueryChain([{ name: "Chicken" }]));

    const result = await service.search({ q: "chicken", type: "products" } as any);

    expect(result.vendors).toEqual([]);
    expect(vendorModel.find).not.toHaveBeenCalled();
  });
});
