import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { Algorithm, hashRaw } from '@node-rs/argon2'

const VERIFIER = Buffer.from('jiazi-vault-verifier-v1', 'utf8')
const KDF_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
}

export interface VaultMetadata {
  version: 1
  kdf: {
    algorithm: 'Argon2id'
    memoryCost: number
    timeCost: number
    parallelism: number
    outputLen: number
    salt: string
  }
  verifier: {
    algorithm: 'AES-256-GCM'
    nonce: string
    ciphertext: string
    authTag: string
  }
}

export interface CreatedVaultCredential {
  metadata: VaultMetadata
  masterKey: Buffer
}

async function deriveKey(password: string, salt: Buffer, options = KDF_OPTIONS) {
  return hashRaw(password, { ...options, algorithm: Algorithm.Argon2id, salt })
}

function encryptVerifier(key: Buffer) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(VERIFIER), cipher.final()])
  return {
    algorithm: 'AES-256-GCM' as const,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

function decryptVerifier(metadata: VaultMetadata, key: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.verifier.nonce, 'base64'))
  decipher.setAuthTag(Buffer.from(metadata.verifier.authTag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(metadata.verifier.ciphertext, 'base64')),
    decipher.final(),
  ])
}

export async function createVaultCredential(password: string): Promise<CreatedVaultCredential> {
  const salt = randomBytes(16)
  const masterKey = await deriveKey(password, salt)
  return {
    masterKey,
    metadata: {
      version: 1,
      kdf: {
        algorithm: 'Argon2id',
        memoryCost: KDF_OPTIONS.memoryCost,
        timeCost: KDF_OPTIONS.timeCost,
        parallelism: KDF_OPTIONS.parallelism,
        outputLen: KDF_OPTIONS.outputLen,
        salt: salt.toString('base64'),
      },
      verifier: encryptVerifier(masterKey),
    },
  }
}

export async function unlockVaultCredential(password: string, metadata: VaultMetadata) {
  if (
    metadata.version !== 1
    || metadata.kdf.algorithm !== 'Argon2id'
    || metadata.verifier.algorithm !== 'AES-256-GCM'
  ) return null

  const masterKey = await deriveKey(password, Buffer.from(metadata.kdf.salt, 'base64'), {
    algorithm: Algorithm.Argon2id,
    memoryCost: metadata.kdf.memoryCost,
    timeCost: metadata.kdf.timeCost,
    parallelism: metadata.kdf.parallelism,
    outputLen: metadata.kdf.outputLen,
  })
  try {
    const verifier = decryptVerifier(metadata, masterKey)
    if (verifier.length !== VERIFIER.length || !timingSafeEqual(verifier, VERIFIER)) {
      masterKey.fill(0)
      return null
    }
    return masterKey
  } catch {
    masterKey.fill(0)
    return null
  }
}

export function clearKey(key: Buffer | null) {
  key?.fill(0)
}
