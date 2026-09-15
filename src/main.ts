import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import {SwaggerModule, DocumentBuilder} from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

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
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
      .setTitle('CampusBid Backend')
      .setDescription('The backend for Ecommerce CampusBid site')
      .setVersion('1.0')
      .addTag('Ecommerce CampusBid')
      .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
