import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ACCESS_COOKIE } from '../../../config/cookie.config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: (req: Request) => {
        // Cookie takes priority, then fall back to Bearer header
        if (req?.cookies?.[ACCESS_COOKIE]) return req.cookies[ACCESS_COOKIE] as string;
        return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
      },
      secretOrKey: config.get<string>('jwt.accessSecret') ?? '',
      ignoreExpiration: false,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    const { passwordHash, refreshToken, ...safe } = user;
    return safe;
  }
}
