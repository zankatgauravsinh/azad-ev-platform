import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(AppConfigService);

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({
    origin: config.get('WEB_ORIGIN'),
    credentials: true,
  });
  app.enableShutdownHooks();

  // OpenAPI / Swagger UI at /api/docs (JSON at /api/docs-json).
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

  const port = config.get('API_PORT');
  await app.listen(port);
  Logger.log(`AZAD EV POINT API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`API docs at http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
