import { UnauthorizedException } from "@nestjs/common";
import { Types } from "mongoose";
import { AccessTokenStrategy } from "./access-token.strategy";

describe("AccessTokenStrategy", () => {
  const accountId = new Types.ObjectId().toString();
  const vendorPayload = { sub: accountId, email: "vendor@test.com", role: "vendor" };
  const studentPayload = { sub: accountId, email: "student@test.com", role: "student" };

  let strategy: AccessTokenStrategy;
  let connection: any;
  let cacheManager: any;
  let selectAccount: jest.Mock;

  const givenStoredAccount = (account: { isActive?: boolean } | null) => {
    selectAccount.mockResolvedValue(account);
  };

  beforeEach(() => {
    selectAccount = jest.fn();
    connection = {
      model: jest.fn().mockReturnValue({
        findById: jest.fn().mockReturnValue({ select: selectAccount }),
      }),
    };
    cacheManager = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    const configService: any = { get: jest.fn().mockReturnValue("test-secret") };

    strategy = new AccessTokenStrategy(configService, connection, cacheManager);
  });

  it("returns the payload for an active account", async () => {
    givenStoredAccount({ isActive: true });

    await expect(strategy.validate(vendorPayload)).resolves.toEqual(vendorPayload);
  });

  it("rejects an inactive (pending or suspended) account", async () => {
    givenStoredAccount({ isActive: false });

    await expect(strategy.validate(vendorPayload)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a token whose account no longer exists", async () => {
    givenStoredAccount(null);

    await expect(strategy.validate(studentPayload)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a token whose subject is not a valid id", async () => {
    await expect(strategy.validate({ ...studentPayload, sub: "not-an-id" })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("looks vendors up in the Vendor model", async () => {
    givenStoredAccount({ isActive: true });

    await strategy.validate(vendorPayload);

    expect(connection.model).toHaveBeenCalledWith("Vendor");
  });

  it("looks students and admins up in the User model", async () => {
    givenStoredAccount({ isActive: true });

    await strategy.validate(studentPayload);

    expect(connection.model).toHaveBeenCalledWith("User");
  });

  it("uses a cached status without querying the database", async () => {
    cacheManager.get.mockResolvedValue(false);

    await expect(strategy.validate(vendorPayload)).rejects.toThrow(UnauthorizedException);
    expect(connection.model).not.toHaveBeenCalled();
  });

  it("caches the looked-up status under the account's key", async () => {
    givenStoredAccount({ isActive: true });

    await strategy.validate(vendorPayload);

    expect(cacheManager.set).toHaveBeenCalledWith(`account-active:Vendor:${accountId}`, true, expect.any(Number));
  });
});
