import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';

@Injectable()
// Named distinctly from the users module's GoogleStrategy — see the comment
// there for why sharing the name 'google' broke both flows.
export class GoogleStrategy extends PassportStrategy(Strategy, 'google-vendor') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL = configService.get<string>('GOOGLE_CALLBACK_URL_VENDOR');

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error('Missing required Google OAuth configuration');
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback
  ): Promise<any> {    
    const user = {
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      profileImage: profile.photos?.[0]?.value,
    };

    done(null, user);
  }
}