import { IsEmail, IsString, MinLength } from "class-validator";

export class VendorLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
