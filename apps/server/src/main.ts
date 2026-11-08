import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppModule } from "./app.module.js";
import { ConfigService } from "./config/config.service.js";
import { FixedWindowRateLimiter } from "./common/rate-limit.js";

function acquireLock(lockPath: string): () => void {
  try {
    if (existsSync(lockPath)) {
      const pid = Number(readFileSync(lockPath, "utf8").trim());
      if (pid && pid !== process.pid) {
        let alive = false;
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (error) {
          alive = (error as NodeJS.ErrnoException).code === "EPERM";
        }
        if (alive) {
          process.stderr.write(
            `[feishu-orgwatch] 已有实例在运行（PID ${pid}），请先执行 ./stop.sh 或使用其他工作目录。\n`,
          );
          process.exit(1);
        }
      }
    }
    writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600 });
    chmodSync(lockPath, 0o600);
  } catch (error) {
    process.stderr.write(`[feishu-orgwatch] 无法写入实例锁：${(error as Error).message}\n`);
  }
  return () => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
        unlinkSync(lockPath);
      }
    } catch {
      // best effort
    }
  };
}

async function bootstrap(): Promise<void> {
  const config = new ConfigService();
  const releaseLock = acquireLock(config.lockPath);
  const logger = new Logger("Bootstrap");

  const adapter = new FastifyAdapter({
    bodyLimit: 1024 * 1024,
    trustProxy: config.trustProxy,
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "*.app_secret",
          "*.appSecret",
        ],
        censor: "[redacted]",
      },
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: false,
  });
  await app.register(fastifyCookie as never);
  app.setGlobalPrefix("api");

  const fastify = app.getHttpAdapter().getInstance();
  const limiter = new FixedWindowRateLimiter();
  let requestCount = 0;

  fastify.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "";
    if (!pathname.startsWith("/api/")) return;
    const isLogin = pathname === "/api/auth/login";
    const decision = limiter.check(
      `${isLogin ? "login" : "api"}:${request.ip || "unknown"}`,
      isLogin ? 10 : 1200,
      60_000,
    );
    requestCount += 1;
    if (requestCount % 1000 === 0 || limiter.size > 10_000) limiter.sweep();
    if (!decision.allowed) {
      reply.header("retry-after", String(decision.retryAfterSeconds));
      reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" },
      });
      return;
    }
  });

  fastify.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) {
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
    }
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; manifest-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    return payload;
  });
  if (existsSync(path.join(config.webDist, "index.html"))) {
    await fastify.register(fastifyStatic as never, {
      root: config.webDist,
      prefix: "/",
      wildcard: false,
    });
    const serveApp = (request: { url: string }, reply: { code: (status: number) => { send: (body: unknown) => unknown }; sendFile: (file: string) => unknown }) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "接口不存在" } });
      }
      return reply.sendFile("index.html");
    };
    fastify.get("/*", serveApp as never);
  }

  await app.listen({ port: config.port, host: config.host });
  logger.log(`feishu-orgwatch 已启动：http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`);
  const defaultAdminFile = path.join(config.runtimeDir, "default-admin.txt");
  if (existsSync(defaultAdminFile)) {
    logger.warn(`默认管理员随机初始密码见 ${defaultAdminFile}，请登录后立即修改`);
  }
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.log(`收到 ${signal}，正在停止服务…`);
    try {
      await app.close();
    } finally {
      releaseLock();
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("exit", releaseLock);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`[feishu-orgwatch] 启动失败：${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
