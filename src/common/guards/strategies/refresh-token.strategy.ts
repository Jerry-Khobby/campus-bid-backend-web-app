import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';



@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private configService: ConfigService) {
super({
  jwtFromRequest:ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: configService.get<string>('JWT_REFRESH_SECRET') || 'fallback',
  passReqToCallback: true,
})
  }

  validate(req: Request, payload: any) {
    const refreshToken = this.extractTokenFromHeader(req);
    return {
      ...payload,
      refreshToken,
    };
  }
  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}