import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { configureHttpApp } from './common/http/configure-http-app';

/** The WebView origins of the native app (Capacitor). */
const NATIVE_APP_ORIGINS = ['http://localhost', 'https://localhost', 'capacitor://localhost'];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  configureHttpApp(app);
  const config = app.get(AppConfigService);

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  // The website uses WEB_ORIGIN; the Android / iOS app (Capacitor) always calls from its own WebView origin —
  // http(s)://localhost on Android, capacitor://localhost on iOS — in production too. Safe to allow: the app
  // authenticates with bearer tokens it sends itself, not with browser cookies.
  const corsOrigins = [config.get('WEB_ORIGIN'), ...NATIVE_APP_ORIGINS];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  app.enableShutdownHooks();

  // OpenAPI / Swagger UI at /api/docs — dev/staging only; never expose the full
  // API surface publicly in production.
  if (!config.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AZAD EV POINT API')
      .setDescription('Showroom management system for a single EV dealership (Una, Gujarat).')
      .setVersion('0.1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Bind 0.0.0.0 so the API is reachable from the LAN (mobile/Capacitor clients).
  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');
  Logger.log(`AZAD EV POINT API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  if (!config.isProduction) Logger.log(`API docs at http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
