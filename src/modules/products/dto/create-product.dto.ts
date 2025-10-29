import { ApiProperty } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsMongoId,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class SpecificationsDto {
  @ApiProperty({ example: "1kg", required: false })
  @IsOptional()
  @IsString()
  weight?: string;

  @ApiProperty({ example: "10x20x5 cm", required: false })
  @IsOptional()
  @IsString()
  dimensions?: string;

  @ApiProperty({ example: { color: "red" }, required: false })
  @IsOptional()
  other?: Record<string, any>;
}

export class CreateProductDto {
  // @ApiProperty({ description: "Vendor ID", example: "652e1a7e123abc9876def012" })
  // @IsOptional()
  // @IsMongoId()
  // vendorId?: string;

  @ApiProperty({ example: "Chicken Sandwich" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: "Delicious grilled chicken sandwich", required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: "Food" })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ example: ["https://example.com/img1.jpg"], required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiProperty({ example: 25.99 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 20.99, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPrice?: number;

  @ApiProperty({ example: 50, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiProperty({ example: 15, description: "Preparation time in minutes", required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  preparationTime?: number;

  @ApiProperty({ example: ["chicken", "grilled"], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ type: SpecificationsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => SpecificationsDto)
  specifications?: SpecificationsDto;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  isFlashSale?: boolean;

  @ApiProperty({ example: "6531cdef1234567890abcd12", required: false })
  @IsOptional()
  @IsMongoId()
  flashSaleId?: string;
}
