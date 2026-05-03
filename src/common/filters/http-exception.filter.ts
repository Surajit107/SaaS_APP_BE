import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  getMongoDuplicateKeyError,
  mapDuplicateKeyMessageToClient,
} from '../utils/mongo-duplicate-key-message';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    const duplicate = getMongoDuplicateKeyError(exception);
    if (duplicate) {
      status = HttpStatus.CONFLICT;
      message = mapDuplicateKeyMessageToClient(duplicate);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
      ) {
        const raw = exceptionResponse.message;
        if (Array.isArray(raw)) {
          message = raw.map(String).join(', ');
        } else if (typeof raw === 'string') {
          message = raw;
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }
    } else if (
      exception instanceof Error &&
      process.env.NODE_ENV !== 'production'
    ) {
      message = exception.message;
    }

    const body: {
      success: false;
      message: string;
      data: null;
      path: string;
    } = {
      success: false,
      message,
      data: null,
      path: request.url ?? '',
    };

    response.status(status).json(body);
  }
}
