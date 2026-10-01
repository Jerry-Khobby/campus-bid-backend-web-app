import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

/**
 * The chat service throws HTTP exceptions (shared with the REST controller). Socket.IO would report
 * those as a generic "Internal server error", so they are re-emitted with their status and message.
 */
@Catch(HttpException)
export class WsHttpExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    super.catch(new WsException(exception.getResponse()), host);
  }
}
