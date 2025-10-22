import { IsEmail, IsString, MinLength,IsStrongPassword } from 'class-validator';

export class LoginDto {
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
}
