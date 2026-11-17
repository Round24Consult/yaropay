import { Global, Inject, Logger, Module, type OnApplicationShutdown } from "@nestjs/common"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { type DatabaseHandle, openDatabase } from "./db.js"

export const DB_HANDLE = Symbol("DB_HANDLE")
export const DB = Symbol("DB")

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig) => {
        const handle = await openDatabase(config)
        if (config.migrateOnStart) await handle.migrate()
        new Logger("Database").log(
          handle.kind === "postgres" ? "Connected to Postgres" : `Using embedded PGlite (${config.database.kind === "pglite" ? config.database.dir : ""})`,
        )
        return handle
      },
    },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: DatabaseHandle) => h.db },
  ],
  exports: [DB, DB_HANDLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DatabaseHandle) {}
  async onApplicationShutdown() {
    await this.handle.close()
  }
}
