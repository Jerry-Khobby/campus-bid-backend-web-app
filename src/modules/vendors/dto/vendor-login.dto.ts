import { IsEmail, IsString, MinLength,IsStrongPassword } from "class-validator";

export class VendorLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
    @IsStrongPassword({
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    })
  password: string;
}
