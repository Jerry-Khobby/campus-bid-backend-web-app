import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class VendorLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
