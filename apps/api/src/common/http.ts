import { Global, Module } from "@nestjs/common"

/** Outgoing HTTP goes through this token so tests can replace the network. */
export const FETCH = Symbol("FETCH")
export type FetchFn = typeof fetch

@Global()
@Module({ providers: [{ provide: FETCH, useValue: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch }], exports: [FETCH] })
export class HttpModule {}
