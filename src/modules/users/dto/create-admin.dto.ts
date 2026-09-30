import { IsEmail, IsString, IsOptional, IsStrongPassword } from 'class-validator';

export class CreateAdminDto {
  @IsEmail() email: string;

  @IsString()
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  password: string;

  @IsString() @IsOptional() firstName?: string;
  @IsString() @IsOptional() lastName?: string;
}
