import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingMiddleware } from './common/middleware/logging.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const bodySizeLimit = process.env.BODY_SIZE_LIMIT ?? '50mb';
  const defaultAllowedOrigins = ['http://localhost:3001', 'http://localhost:3000'];
  const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(
    (configuredOrigins.length > 0 ? configuredOrigins : defaultAllowedOrigins).map((origin) =>
      origin.replace(/\/$/, ''),
    ),
  );

  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: bodySizeLimit }));
  app.use(urlencoded({ extended: true, limit: bodySizeLimit }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin.replace(/\/$/, ''))) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.use(new LoggingMiddleware().use);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
