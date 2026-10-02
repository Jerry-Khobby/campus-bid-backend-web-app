import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { Error as MongooseError } from "mongoose";

// Malformed ids and schema violations are client mistakes; without this they
// escape services as raw Mongoose errors and surface as 500s.
@Catch(MongooseError.CastError, MongooseError.ValidationError)
export class MongooseExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(exception: MongooseError.CastError | MongooseError.ValidationError, host: ArgumentsHost): void {
    super.catch(new BadRequestException(this.describe(exception)), host);
  }

  private describe(exception: MongooseError.CastError | MongooseError.ValidationError): string {
    if (exception instanceof MongooseError.CastError) {
      return `Invalid ${exception.path}`;
    }

    return Object.values(exception.errors)
      .map((fieldError) => fieldError.message)
      .join(", ");
  }
}
