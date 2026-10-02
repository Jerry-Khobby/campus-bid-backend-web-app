import { ForbiddenException } from "@nestjs/common";
import { ProductsController } from "./products.controller";

describe("ProductsController.addProductImages", () => {
  const productId = "product-1";
  const request = { user: { sub: "vendor-1" } };
  const image = { originalname: "a.png", mimetype: "image/png" } as Express.Multer.File;

  let productsService: any;
  let cloudinaryService: any;
  let controller: ProductsController;

  beforeEach(() => {
    productsService = {
      assertVendorOwnsProduct: jest.fn().mockResolvedValue(undefined),
      addProductImages: jest.fn().mockResolvedValue(["https://cdn/a.png"]),
    };
    cloudinaryService = { uploadImage: jest.fn().mockResolvedValue({ secure_url: "https://cdn/a.png" }) };
    controller = new ProductsController(productsService, cloudinaryService);
  });

  it("checks ownership before uploading anything", async () => {
    await controller.addProductImages(productId, request, [image]);

    const ownershipCheckOrder = productsService.assertVendorOwnsProduct.mock.invocationCallOrder[0];
    const uploadOrder = cloudinaryService.uploadImage.mock.invocationCallOrder[0];
    expect(ownershipCheckOrder).toBeLessThan(uploadOrder);
  });

  it("does not upload when the vendor does not own the product", async () => {
    productsService.assertVendorOwnsProduct.mockRejectedValue(new ForbiddenException());

    await controller.addProductImages(productId, request, [image]).catch(() => undefined);

    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
  });

  it("rejects the request when the vendor does not own the product", async () => {
    productsService.assertVendorOwnsProduct.mockRejectedValue(new ForbiddenException());

    await expect(controller.addProductImages(productId, request, [image])).rejects.toThrow(ForbiddenException);
  });
});
