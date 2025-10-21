import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ProfileDto {
  @IsString() @IsOptional() firstName?: string;
  @IsString() @IsOptional() lastName?: string;
  @IsString() @IsOptional() phoneNumber?: string;
  @IsString() @IsOptional() university?: string;
  @IsString() @IsOptional() studentId?: string;
  @IsString() @IsOptional() profileImage?: string;
}

export class UpdateProfileDto {
  @ValidateNested() @Type(() => ProfileDto) @IsOptional() profile?: ProfileDto;
}
