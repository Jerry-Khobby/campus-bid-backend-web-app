import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { FilterProductDto } from "./filter-product.dto";

function toDto(query: Record<string, string>): FilterProductDto {
  return plainToInstance(FilterProductDto, query);
}

describe("FilterProductDto", () => {
  it.each(["isAvailable", "isFlashSale"])("turns the query string 'true' into true for %s", (field) => {
    const dto = toDto({ [field]: "true" });

    expect(dto[field]).toBe(true);
  });

  it.each(["isAvailable", "isFlashSale"])("turns the query string 'false' into false for %s", (field) => {
    const dto = toDto({ [field]: "false" });

    expect(dto[field]).toBe(false);
  });

  it("passes validation for a boolean query string", async () => {
    const errors = await validate(toDto({ isAvailable: "false", isFlashSale: "true" }));

    expect(errors).toEqual([]);
  });

  it("rejects a value that is not a boolean", async () => {
    const errors = await validate(toDto({ isAvailable: "yes" }));

    expect(errors.map((error) => error.property)).toEqual(["isAvailable"]);
  });
});
