import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Types } from "mongoose";
import * as bcrypt from "bcrypt";

import { UserService } from "./user.service";
import { User } from "./schema/user.schema";
import { Order } from "../orders/schema/order.schema";
import { MailService } from "../../utils/mail.service";
import { CloudinaryService } from "../uploads/cloudinary.service";

// Simulates a Mongoose subdocument array's .id()/.pull() helpers on a plain array.
function toSubdocArray(items: any[]) {
  const arr: any = [...items];
  arr.id = (id: string) => arr.find((item: any) => item._id.toString() === id) || null;
  arr.pull = (id: string) => {
    const index = arr.findIndex((item: any) => item._id.toString() === id);
    if (index !== -1) arr.splice(index, 1);
  };
  return arr;
}

const APP_URLS: Record<string, string> = {
  APP_URL: "http://customer.test",
  ADMIN_APP_URL: "http://admin.test",
};

describe("UserService", () => {
  let service: UserService;
  let userModel: any;
  let mailService: any;
  let jwtService: any;
  let cacheManager: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockAddressId = new Types.ObjectId().toString();
  const mockPaymentMethodId = new Types.ObjectId().toString();

  beforeEach(async () => {
    userModel = Object.assign(
      jest.fn().mockImplementation((doc: any) => ({
        ...doc,
        save: jest.fn().mockResolvedValue({ ...doc, toObject: () => ({ ...doc }) }),
      })),
      {
        findById: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        updateOne: jest.fn(),
        findOne: jest.fn(),
      },
    );
    const orderModel = {
      aggregate: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: MailService, useValue: { sendEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => APP_URLS[key]) } },
        { provide: CloudinaryService, useValue: { uploadImage: jest.fn() } },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    mailService = module.get(MailService);
    jwtService = module.get(JwtService);
    cacheManager = module.get(CACHE_MANAGER);
  });

  describe("updateUser", () => {
    it("merges profile fields and returns the safe user", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const user = {
        email: "student@test.com",
        profile: { firstName: "Old" },
        save,
        toObject() {
          return { ...this };
        },
      };
      userModel.findById.mockResolvedValue(user);

      const result = await service.updateUser(mockUserId, {
        profile: { firstName: "New" },
      } as any);

      expect(user.profile.firstName).toBe("New");
      expect(save).toHaveBeenCalled();
      expect((result as any).password).toBeUndefined();
    });

    it("throws NotFoundException when the user does not exist", async () => {
      userModel.findById.mockResolvedValue(null);

      await expect(service.updateUser(mockUserId, {} as any)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("updateProfileImage", () => {
    it("sets the profile image url and saves", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const user = {
        email: "student@test.com",
        profile: {} as { profileImage?: string },
        save,
        toObject() {
          return { ...this };
        },
      };
      userModel.findById.mockResolvedValue(user);

      await service.updateProfileImage(mockUserId, "https://cdn.test/image.png");

      expect(user.profile.profileImage).toBe("https://cdn.test/image.png");
      expect(save).toHaveBeenCalled();
    });

    it("throws NotFoundException when the user does not exist", async () => {
      userModel.findById.mockResolvedValue(null);

      await expect(
        service.updateProfileImage(mockUserId, "https://cdn.test/image.png")
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getAddresses", () => {
    it("returns the user's addresses", async () => {
      const addresses = [{ label: "Dorm" }];
      userModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ addresses }),
      });

      const result = await service.getAddresses(mockUserId);

      expect(result).toBe(addresses);
    });

    it("throws NotFoundException when the user does not exist", async () => {
      userModel.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

      await expect(service.getAddresses(mockUserId)).rejects.toThrow(NotFoundException);
    });
  });

  describe("addAddress", () => {
    const dto = { label: "Dorm", latitude: 5.6, longitude: -0.2, isDefault: true };

    it("clears other defaults, pushes the address, and returns the updated list", async () => {
      userModel.findById.mockResolvedValue({ email: "student@test.com" });
      userModel.updateOne.mockResolvedValue({});
      const pushedAddresses = [{ label: "Dorm", isDefault: true }];
      userModel.findByIdAndUpdate.mockResolvedValue({ addresses: pushedAddresses });

      const result = await service.addAddress(mockUserId, dto as any);

      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId },
        { $set: { "addresses.$[].isDefault": false } }
      );
      expect(result).toBe(pushedAddresses);
    });

    it("throws NotFoundException when the user does not exist", async () => {
      userModel.findById.mockResolvedValue(null);

      await expect(service.addAddress(mockUserId, dto as any)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("updateAddress", () => {
    it("throws BadRequestException for an invalid address id", async () => {
      await expect(
        service.updateAddress(mockUserId, "not-an-id", {} as any)
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException when the user does not exist", async () => {
      userModel.findById.mockResolvedValue(null);

      await expect(
        service.updateAddress(mockUserId, mockAddressId, {} as any)
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when the address subdocument is missing", async () => {
      userModel.findById.mockResolvedValue({ addresses: toSubdocArray([]) });

      await expect(
        service.updateAddress(mockUserId, mockAddressId, {} as any)
      ).rejects.toThrow(NotFoundException);
    });

    it("merges fields into the matching address and saves", async () => {
      const address = {
        _id: mockAddressId,
        label: "Old label",
        location: { type: "Point", coordinates: [-0.2, 5.6] },
      };
      const save = jest.fn().mockResolvedValue(true);
      const user = { email: "student@test.com", addresses: toSubdocArray([address]), save };
      userModel.findById.mockResolvedValue(user);

      const result = await service.updateAddress(mockUserId, mockAddressId, {
        label: "New label",
      } as any);

      expect(address.label).toBe("New label");
      expect(save).toHaveBeenCalled();
      expect(result).toBe(user.addresses);
    });
  });

  describe("deleteAddress", () => {
    it("throws BadRequestException for an invalid address id", async () => {
      await expect(service.deleteAddress(mockUserId, "not-an-id")).rejects.toThrow(
        BadRequestException
      );
    });

    it("throws NotFoundException when the address subdocument is missing", async () => {
      userModel.findById.mockResolvedValue({ addresses: toSubdocArray([]) });

      await expect(service.deleteAddress(mockUserId, mockAddressId)).rejects.toThrow(
        NotFoundException
      );
    });

    it("pulls the matching address and saves", async () => {
      const address = { _id: mockAddressId, label: "Dorm" };
      const save = jest.fn().mockResolvedValue(true);
      const addresses = toSubdocArray([address]);
      const user = { email: "student@test.com", addresses, save };
      userModel.findById.mockResolvedValue(user);

      const result = await service.deleteAddress(mockUserId, mockAddressId);

      expect(addresses).toHaveLength(0);
      expect(save).toHaveBeenCalled();
      expect(result).toBe(addresses);
    });
  });

  describe("getPaymentMethods", () => {
    it("returns the user's payment methods", async () => {
      const paymentMethods = [{ last4: "4242" }];
      userModel.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ paymentMethods }),
      });

      const result = await service.getPaymentMethods(mockUserId);

      expect(result).toBe(paymentMethods);
    });

    it("throws NotFoundException when the user does not exist", async () => {
      userModel.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

      await expect(service.getPaymentMethods(mockUserId)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("addPaymentMethod", () => {
    const dto = { type: "card", provider: "visa", last4: "4242", isDefault: true };

    it("clears other defaults, pushes the method, and returns the updated list", async () => {
      userModel.findById.mockResolvedValue({ email: "student@test.com" });
      userModel.updateOne.mockResolvedValue({});
      const pushed = [{ last4: "4242", isDefault: true }];
      userModel.findByIdAndUpdate.mockResolvedValue({ paymentMethods: pushed });

      const result = await service.addPaymentMethod(mockUserId, dto as any);

      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: mockUserId },
        { $set: { "paymentMethods.$[].isDefault": false } }
      );
      expect(result).toBe(pushed);
    });

    it("throws NotFoundException when the user does not exist", async () => {
      userModel.findById.mockResolvedValue(null);

      await expect(service.addPaymentMethod(mockUserId, dto as any)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("deletePaymentMethod", () => {
    it("throws BadRequestException for an invalid payment method id", async () => {
      await expect(
        service.deletePaymentMethod(mockUserId, "not-an-id")
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException when the payment method subdocument is missing", async () => {
      userModel.findById.mockResolvedValue({ paymentMethods: toSubdocArray([]) });

      await expect(
        service.deletePaymentMethod(mockUserId, mockPaymentMethodId)
      ).rejects.toThrow(NotFoundException);
    });

    it("pulls the matching payment method and saves", async () => {
      const method = { _id: mockPaymentMethodId, last4: "4242" };
      const save = jest.fn().mockResolvedValue(true);
      const paymentMethods = toSubdocArray([method]);
      const user = { email: "student@test.com", paymentMethods, save };
      userModel.findById.mockResolvedValue(user);

      const result = await service.deletePaymentMethod(mockUserId, mockPaymentMethodId);

      expect(paymentMethods).toHaveLength(0);
      expect(save).toHaveBeenCalled();
      expect(result).toBe(paymentMethods);
    });
  });

  describe("createAdmin", () => {
    const dto = {
      email: "New.Admin@Test.com",
      password: "StrongPass1!",
      firstName: "New",
      lastName: "Admin",
    };

    it("throws ConflictException when the email is already registered", async () => {
      userModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ email: "new.admin@test.com" }) });

      await expect(service.createAdmin(dto)).rejects.toThrow(ConflictException);
      expect(userModel).not.toHaveBeenCalled();
    });

    it("creates the account with role admin and returns it without the password", async () => {
      userModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      const result = await service.createAdmin(dto);

      expect(userModel).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new.admin@test.com",
          role: "admin",
          isVerified: true,
          profile: { firstName: "New", lastName: "Admin" },
        }),
      );
      expect((result as any).password).toBeUndefined();
      expect((result as any).role).toBe("admin");
    });
  });

  describe("forgotPassword", () => {
    const sentEmailBody = () => mailService.sendEmail.mock.calls[0][2];

    it("never returns the reset token in the response", async () => {
      userModel.findOne.mockResolvedValue({ _id: mockUserId, role: "student", profile: {} });

      const result = await service.forgotPassword({ email: "student@test.com" });

      expect(result).not.toHaveProperty("resetToken");
    });

    it("returns the same response for an unknown email without sending mail", async () => {
      userModel.findOne.mockResolvedValue({ _id: mockUserId, role: "student", profile: {} });
      const knownEmailResult = await service.forgotPassword({ email: "student@test.com" });
      mailService.sendEmail.mockClear();
      userModel.findOne.mockResolvedValue(null);

      const unknownEmailResult = await service.forgotPassword({ email: "nobody@test.com" });

      expect(unknownEmailResult).toEqual(knownEmailResult);
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it("links students to the customer app reset page", async () => {
      userModel.findOne.mockResolvedValue({ _id: mockUserId, role: "student", profile: {} });

      await service.forgotPassword({ email: "student@test.com" });

      expect(sentEmailBody()).toContain("http://customer.test/reset-password?token=");
    });

    it("links admins to the admin app reset page", async () => {
      userModel.findOne.mockResolvedValue({ _id: mockUserId, role: "admin", profile: {} });

      await service.forgotPassword({ email: "admin@test.com" });

      expect(sentEmailBody()).toContain("http://admin.test/admin/reset-password?token=");
    });
  });

  describe("forgotPassword delivery", () => {
    it("responds without waiting for the email to be sent", async () => {
      userModel.findOne.mockResolvedValue({ _id: mockUserId, role: "student", profile: {} });
      mailService.sendEmail.mockReturnValue(new Promise(() => undefined));

      await expect(service.forgotPassword({ email: "student@test.com" })).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );
    });

    it("still returns the generic response when the email fails to send", async () => {
      userModel.findOne.mockResolvedValue({ _id: mockUserId, role: "student", profile: {} });
      mailService.sendEmail.mockRejectedValue(new Error("SMTP down"));

      await expect(service.forgotPassword({ email: "student@test.com" })).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );
    });
  });

  describe("loginUser", () => {
    const PASSWORD = "StrongPass1!";
    const TEST_SALT_ROUNDS = 4;
    let passwordHash: string;

    const buildLoginUser = (overrides: Record<string, any> = {}) => {
      const doc = {
        _id: mockUserId,
        email: "student@test.com",
        role: "student",
        password: passwordHash,
        refreshToken: "stored-refresh-hash",
        isActive: true,
        ...overrides,
      };
      return { ...doc, toObject: () => ({ ...doc }) };
    };

    beforeAll(async () => {
      passwordHash = await bcrypt.hash(PASSWORD, TEST_SALT_ROUNDS);
    });

    beforeEach(() => {
      jwtService.signAsync.mockResolvedValue("signed-token");
    });

    it("rejects an unknown email with the generic 401", async () => {
      userModel.findOne.mockResolvedValue(null);

      await expect(service.loginUser({ email: "nobody@test.com", password: PASSWORD })).rejects.toThrow(
        new UnauthorizedException("Invalid email or password"),
      );
    });

    it("rejects a wrong password with the same generic 401", async () => {
      userModel.findOne.mockResolvedValue(buildLoginUser());

      await expect(service.loginUser({ email: "student@test.com", password: "Wrong1!pass" })).rejects.toThrow(
        new UnauthorizedException("Invalid email or password"),
      );
    });

    it("rejects a Google-only account with the same generic 401", async () => {
      userModel.findOne.mockResolvedValue(buildLoginUser({ password: undefined }));

      await expect(service.loginUser({ email: "student@test.com", password: PASSWORD })).rejects.toThrow(
        new UnauthorizedException("Invalid email or password"),
      );
    });

    it("rejects a suspended account that knows its password", async () => {
      userModel.findOne.mockResolvedValue(buildLoginUser({ isActive: false }));

      await expect(service.loginUser({ email: "student@test.com", password: PASSWORD })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("never returns the refresh-token hash or password in the user object", async () => {
      userModel.findOne.mockResolvedValue(buildLoginUser());

      const result = await service.loginUser({ email: "student@test.com", password: PASSWORD });

      expect(Object.keys(result.user)).toEqual(expect.not.arrayContaining(["password", "refreshToken"]));
    });
  });

  describe("createUser", () => {
    beforeEach(() => {
      userModel.mockImplementation((doc: any) => ({
        ...doc,
        save: jest.fn().mockResolvedValue({
          ...doc,
          _id: mockUserId,
          toObject: () => ({ ...doc, refreshToken: null }),
        }),
      }));
      userModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      jwtService.signAsync.mockResolvedValue("signed-token");
    });

    it("never persists a client-supplied refresh token", async () => {
      const dto: any = { email: "new@test.com", password: "StrongPass1!", refreshToken: "client-value" };

      await service.createUser(dto);

      expect(userModel.mock.calls[0][0]).not.toHaveProperty("refreshToken");
    });

    it("never returns the refresh-token field in the user object", async () => {
      const result = await service.createUser({ email: "new@test.com", password: "StrongPass1!" });

      expect(result.user).not.toHaveProperty("refreshToken");
    });
  });

  describe("password changes revoke sessions", () => {
    const buildUserWithSession = (password?: string) => ({
      _id: mockUserId,
      email: "student@test.com",
      password,
      refreshToken: "stored-refresh-hash",
      save: jest.fn(),
    });

    it("clears the stored refresh token on password reset", async () => {
      const user = buildUserWithSession();
      cacheManager.get.mockResolvedValue(mockUserId);
      userModel.findById.mockResolvedValue(user);

      await service.resetPassword({ token: "reset-token", newPassword: "NewStrong1!" });

      expect(user.refreshToken).toBeUndefined();
    });

    it("clears the stored refresh token on password change", async () => {
      const user = buildUserWithSession(await bcrypt.hash("OldStrong1!", 4));
      userModel.findById.mockResolvedValue(user);

      await service.changePassword(mockUserId, { oldPassword: "OldStrong1!", newPassword: "NewStrong1!" });

      expect(user.refreshToken).toBeUndefined();
    });
  });

  describe("suspended accounts", () => {
    it("cannot refresh tokens", async () => {
      userModel.findById.mockResolvedValue({ _id: mockUserId, refreshToken: "hash", isActive: false });

      await expect(service.refreshTokens(mockUserId, "refresh-token")).rejects.toThrow(ForbiddenException);
    });

    it("cannot sign in with Google", async () => {
      userModel.findOne.mockResolvedValue({ _id: mockUserId, email: "student@test.com", isActive: false });

      await expect(
        service.handleGoogleLogin({ googleId: "g-1", email: "student@test.com", firstName: "A", lastName: "B" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("lose live access-token sessions as soon as they are suspended", async () => {
      const suspended = { _id: mockUserId, role: "student", isActive: false, toObject: () => ({}) };
      userModel.findByIdAndUpdate.mockResolvedValue(suspended);

      await service.suspendUser(mockUserId);

      expect(cacheManager.del).toHaveBeenCalledWith(`account-active:User:${mockUserId}`);
    });
  });
});
