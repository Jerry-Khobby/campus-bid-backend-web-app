import { IsString, MinLength,IsStrongPassword } from 'class-validator';

export class ChangePasswordDto {
  @IsString()   @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
   oldPassword: string;
  @IsString()  
   @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  }) newPassword: string;
}
