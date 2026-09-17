import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';

@Injectable()
// Named distinctly from the vendors module's GoogleStrategy — Passport keys
// strategies globally by name, and two providers both named 'google' meant
// whichever loaded last silently overwrote the other's config (callback URL
// included) for every AuthGuard('google') call, customer or vendor.
export class GoogleStrategy extends PassportStrategy(Strategy, 'google-user') {
  constructor(private configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL = configService.get<string>('GOOGLE_CALLBACK_URL');

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