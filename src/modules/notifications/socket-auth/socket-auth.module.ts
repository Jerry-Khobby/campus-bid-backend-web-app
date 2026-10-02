import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SocketAuthService } from './socket-auth.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [SocketAuthService],
  exports: [SocketAuthService],
})
export class SocketAuthModule {}
