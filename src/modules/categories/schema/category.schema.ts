import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type CategoryDocument = Category & Document;

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop()
  icon?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  sortOrder: number;
}

export const CategorySchema = SchemaFactory.createForClass(Category);

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Must run in the "validate" phase, not "save" — Mongoose validates required
// fields (including slug) before pre("save") hooks ever run, so setting it
// there would always be one step too late.
CategorySchema.pre("validate", function (next) {
  if (this.isModified("name")) {
    this.slug = toSlug(this.name);
  }
  next();
});
