import { Exclude, Expose, Type } from "class-transformer";

@Exclude()
export class VendorResponseDto {
  @Expose()
  _id: string;

  @Expose()
  email: string;

  @Expose()
  role: string;

  @Expose()
  profile: any;

  @Expose()
  location: any;

  @Expose()
  categories: string[];

  @Expose()
  rating: any;

  @Expose()
  stats: any;

  @Expose()
  bankDetails: any;

  @Expose()
  isVerified: boolean;

  @Expose()
  isActive: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
