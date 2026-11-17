import { Global, Inject, Injectable, Module } from "@nestjs/common"
import { APP_CONFIG, type AppConfig } from "../config/config.js"
import { decryptWithKeys, encrypt } from "./crypto.js"

/**
 * Encrypts secrets at rest (gateway credentials, signing secrets, alert URLs, authenticator secrets,
 * saved-card authorizations). Writes always use YAROPAY_ENCRYPTION_KEY; reads also accept
 * YAROPAY_ENCRYPTION_KEY_PREVIOUS during a key rotation.
 */
@Injectable()
export class EncryptionService {
  private readonly keys: Buffer[]

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.keys = [config.encryptionKey, ...config.previousEncryptionKeys]
  }

  encrypt(plaintext: string): string {
    return encrypt(this.config.encryptionKey, plaintext)
  }

  decrypt(payload: string): string {
    return decryptWithKeys(this.keys, payload)
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value))
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T
  }
}

@Global()
@Module({ providers: [EncryptionService], exports: [EncryptionService] })
export class EncryptionModule {}
