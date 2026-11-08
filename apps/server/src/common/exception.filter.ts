import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiError } from "./errors.js";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (reply.sent) return;

    if (exception instanceof ApiError) {
      reply.status(exception.status).send({
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details === undefined ? {} : { details: exception.details }),
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === "string"
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      reply.status(status).send({
        error: {
          code: status === 400 ? "BAD_REQUEST" : `HTTP_${status}`,
          message: Array.isArray(message) ? message.join("; ") : message,
        },
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    reply.status(500).send({
      error: { code: "INTERNAL", message: "服务器内部错误，请查看服务日志" },
    });
  }
}
