import { ArgumentsHost, BadRequestException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { Error as MongooseError } from "mongoose";

import { MongooseExceptionFilter } from "./http-exception.filter";

describe("MongooseExceptionFilter", () => {
  const host = {} as ArgumentsHost;
  let forwardSpy: jest.SpyInstance;
  let filter: MongooseExceptionFilter;

  beforeEach(() => {
    forwardSpy = jest.spyOn(BaseExceptionFilter.prototype, "catch").mockImplementation(() => undefined);
    filter = new MongooseExceptionFilter();
  });

  afterEach(() => {
    forwardSpy.mockRestore();
  });

  it("maps a CastError on a malformed id to a 400 naming the field", () => {
    filter.catch(new MongooseError.CastError("ObjectId", "not-an-id", "_id"), host);

    const forwarded = forwardSpy.mock.calls[0][0] as BadRequestException;
    expect(forwarded.getResponse()).toMatchObject({ statusCode: 400, message: "Invalid _id" });
  });

  it("maps a ValidationError to a 400 listing each field message", () => {
    const validationError = new MongooseError.ValidationError();
    validationError.addError("price", new MongooseError.ValidatorError({ message: "price is required" }));

    filter.catch(validationError, host);

    const forwarded = forwardSpy.mock.calls[0][0] as BadRequestException;
    expect(forwarded.getResponse()).toMatchObject({ statusCode: 400, message: "price is required" });
  });
});
