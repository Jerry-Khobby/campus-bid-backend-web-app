import { IsString, MinLength,IsStrongPassword } from 'class-validator';

export class ResetPasswordDto {
  @IsString() token: string;
  @IsString() 
    @IsStrongPassword({
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    })
  newPassword: string;
}
