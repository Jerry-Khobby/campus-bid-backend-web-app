import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import {SwaggerModule, DocumentBuilder} from "@nestjs/swagger";
import helmet from "helmet";
import { MongooseExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const isProduction = process.env.NODE_ENV === 'production';

  // Swagger UI relies on inline scripts, so the strict CSP is only enforced where Swagger is not served.
  app.use(helmet({ contentSecurityPolicy: isProduction }));

  // Behind a load balancer every request arrives from the proxy's address, which
  // would make rate limiting throttle all users together. Only trust
  // X-Forwarded-For when a proxy is really in front, or clients could spoof it.
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (trustedProxyHops > 0) app.set('trust proxy', trustedProxyHops);

  // The three frontends (customer/vendor/admin) each run on their own port in
  // dev, so every browser request to this API is cross-origin. Nest doesn't
  // enable CORS by default — without this, every fetch() from any of them
  // fails the preflight check before a single request reaches a controller.
  const allowedOrigins = (
    process.env.CORS_ORIGINS ?? 'http://localhost:5000,http://localhost:5001,http://localhost:5002'
  )
    .split(',')
    .map((origin) => origin.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Browsers hide non-safelisted headers from cross-origin code; the frontends
    // read Retry-After to tell a rate-limited user how long to wait.
    exposedHeaders: ['Retry-After'],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.useGlobalFilters(new MongooseExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.setGlobalPrefix('api');

  if (!isProduction) {
    const config = new DocumentBuilder()
        .setTitle('CampusBid Backend')
        .setDescription('The backend for Ecommerce CampusBid site')
        .setVersion('1.0')
        .addTag('Ecommerce CampusBid')
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error('Failed to start the API', error instanceof Error ? error.stack : error);
  process.exit(1);
});
