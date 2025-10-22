import { IsString, MinLength,IsStrongPassword } from 'class-validator';

export class ChangePasswordDto {
  @IsString() @MinLength(6) oldPassword: string;
  @IsString() @MinLength(6) newPassword: string;
}
