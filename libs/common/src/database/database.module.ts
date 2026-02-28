// v2
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        // CRITICAL: getOrThrow returns string "false" not boolean false
        // TypeORM treats string "false" as truthy → synchronize would be ON
        // Always cast explicitly
        const syncRaw = configService.get<string>(
          'POSTGRES_SYNCHRONIZE',
          'false',
        );
        const synchronize = syncRaw === 'true';

        if (synchronize && configService.get('NODE_ENV') === 'production') {
          throw new Error(
            'POSTGRES_SYNCHRONIZE must not be true in production. Use migrations.',
          );
        }

        return {
          type: 'postgres',
          host: configService.getOrThrow<string>('POSTGRES_HOST'),
          port: configService.getOrThrow<number>('POSTGRES_PORT'),
          database: configService.getOrThrow<string>('POSTGRES_DATABASE'),
          username: configService.getOrThrow<string>('POSTGRES_USERNAME'),
          password: configService.getOrThrow<string>('POSTGRES_PASSWORD'),
          autoLoadEntities: true,
          synchronize,
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {
  static forFeature(models: EntityClassOrSchema[]) {
    return TypeOrmModule.forFeature(models);
  }
}
// v1
// import { Module } from '@nestjs/common';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';

// @Module({
//   imports: [
//     ConfigModule,
//     TypeOrmModule.forRootAsync({
//       useFactory: (configService: ConfigService) => ({
//         type: 'postgres',
//         host: configService.getOrThrow<string>('POSTGRES_HOST'),
//         port: configService.getOrThrow<number>('POSTGRES_PORT'),
//         database: configService.getOrThrow<string>('POSTGRES_DATABASE'),
//         username: configService.getOrThrow<string>('POSTGRES_USERNAME'),
//         password: configService.getOrThrow<string>('POSTGRES_PASSWORD'),
//         autoLoadEntities: true,
//         synchronize: configService.getOrThrow('POSTGRES_SYNCHRONIZE'),
//       }),
//       inject: [ConfigService],
//     }),
//   ],
// })
// export class DatabaseModule {
//   static forFeature(models: EntityClassOrSchema[]) {
//     return TypeOrmModule.forFeature(models);
//   }
// }
