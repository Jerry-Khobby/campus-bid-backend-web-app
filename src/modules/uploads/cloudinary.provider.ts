import {v2 as cloudinary} from 'cloudinary'
import { CLOUDINARY } from './constants'


export const CloudinaryProvider = {
  provide: CLOUDINARY,
  useFactory: () => {
    cloudinary.config({
      cloud_name: 'Your cloud name',
      api_key: 'Your api key',
      api_secret: 'Your api secret',
    });

    return cloudinary; // TypeScript now accepts this
  },
};
