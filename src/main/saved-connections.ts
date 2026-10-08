import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { DatabaseConnectionInput, DatabaseKind } from '../shared/database'

export interface SavedConnectionProfile {
  id: string
  name: string
  kind: DatabaseKind
  host: string
  port: number
  database: string
  username: string
  tls: boolean
  serverMode: boolean
  hasSecret: boolean
}

interface StoredConnectionProfile extends Omit<SavedConnectionProfile, 'hasSecret'> {
  secretKind: 'password' | 'connection-string' | null
  encryptedSecret: string | null
}

interface SavedConnectionsFile {
  version: 1
  profiles: StoredConnectionProfile[]
}

const FILE_NAME = 'saved-connections.json'

function hasSecurePasswordStorage(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform !== 'linux') return true
  return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())
}

function storagePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

async function readProfiles(): Promise<StoredConnectionProfile[]> {
  try {
    const parsed = JSON.parse(await readFile(storagePath(), 'utf8')) as Partial<SavedConnectionsFile>
    if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
      throw new Error('Saved connection data has an unsupported format.')
    }
    return parsed.profiles.filter((profile): profile is StoredConnectionProfile =>
      Boolean(profile && typeof profile.id === 'string' && typeof profile.name === 'string'
        && (profile.kind === 'postgres' || profile.kind === 'mongodb')
        && typeof profile.host === 'string' && Number.isInteger(profile.port)
        && typeof profile.database === 'string' && typeof profile.username === 'string'
        && typeof profile.tls === 'boolean' && typeof profile.serverMode === 'boolean'
        && (profile.secretKind === 'password' || profile.secretKind === 'connection-string' || profile.secretKind === null)
        && (typeof profile.encryptedSecret === 'string' || profile.encryptedSecret === null))
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error instanceof Error ? error : new Error('Could not read saved connections.')
  }
}

async function writeProfiles(profiles: StoredConnectionProfile[]): Promise<void> {
  const file = storagePath()
  const directory = path.dirname(file)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporaryFile = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryFile, JSON.stringify({ version: 1, profiles } satisfies SavedConnectionsFile, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryFile, file)
  } catch (error) {
    throw error instanceof Error ? new Error(`Could not securely save connections: ${error.message}`) : new Error('Could not securely save connections.')
  }
}

function toSummary(profile: StoredConnectionProfile): SavedConnectionProfile {
  const { secretKind, encryptedSecret: _encryptedSecret, ...summary } = profile
  return { ...summary, hasSecret: Boolean(secretKind) }
}

export async function listSavedConnections(): Promise<SavedConnectionProfile[]> {
  return (await readProfiles()).map(toSummary)
}

export async function saveConnectionProfile(input: DatabaseConnectionInput): Promise<SavedConnectionProfile> {
  const secretKind = input.connectionString ? 'connection-string' : input.password ? 'password' : null
  const secret = input.connectionString || input.password
  let encryptedSecret: string | null = null
  if (secret) {
    if (!hasSecurePasswordStorage()) {
      throw new Error('Secure credential storage is unavailable on this system. Rowfish did not save the password or connection string; use a session-only connection or enable your operating system credential store.')
    }
    try {
      encryptedSecret = safeStorage.encryptString(secret).toString('base64')
    } catch {
      throw new Error('Rowfish could not encrypt this credential with the operating system credential store.')
    }
  }

  const profile: StoredConnectionProfile = {
    id: randomUUID(),
    name: input.name,
    kind: input.kind,
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    tls: input.tls,
    serverMode: input.serverMode,
    secretKind,
    encryptedSecret
  }
  const profiles = await readProfiles()
  profiles.push(profile)
  await writeProfiles(profiles)
  return toSummary(profile)
}

export async function getSavedConnectionInput(id: string): Promise<DatabaseConnectionInput> {
  const profile = (await readProfiles()).find((candidate) => candidate.id === id)
  if (!profile) throw new Error('This saved connection no longer exists.')
  let password = ''
  if (profile.encryptedSecret) {
    if (!hasSecurePasswordStorage()) {
      throw new Error('The operating system credential store is unavailable, so Rowfish cannot decrypt this saved credential.')
    }
    try {
      password = safeStorage.decryptString(Buffer.from(profile.encryptedSecret, 'base64'))
    } catch {
      throw new Error('Rowfish could not decrypt this saved credential. Re-enter the password or connection string and save the connection again.')
    }
  }
  const { id: _id, secretKind, encryptedSecret: _encryptedSecret, ...input } = profile
  return {
    ...input,
    password: secretKind === 'password' ? password : '',
    ...(secretKind === 'connection-string' ? { connectionString: password } : {})
  }
}

export async function deleteSavedConnection(id: string): Promise<boolean> {
  const profiles = await readProfiles()
  const remaining = profiles.filter((profile) => profile.id !== id)
  if (remaining.length === profiles.length) return false
  await writeProfiles(remaining)
  return true
}
