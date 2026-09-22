import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { File, Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const LOCAL_OBJECT_ID = /^\/objects\/uploads\/[A-Za-z0-9-]+$/;

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

function usesReplitObjectStorage(): boolean {
  return Boolean(process.env.PRIVATE_OBJECT_DIR?.trim());
}

function localStorageRoot(): string {
  const configured = process.env.LOCAL_OBJECT_DIR?.trim();
  if (configured) return configured;
  return path.resolve(process.cwd(), "..", "..", ".local", "object-storage");
}

function localApiOrigin(): string {
  const explicit = (process.env.PUBLIC_API_URL || process.env.EXPO_PUBLIC_API_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = process.env.PORT?.trim() || "8080";
  return `http://127.0.0.1:${port}`;
}

function localObjectPaths(objectPath: string): { filePath: string; metaPath: string } {
  const id = objectPath.slice("/objects/uploads/".length);
  const dir = path.join(localStorageRoot(), "uploads");
  return {
    filePath: path.join(dir, id),
    metaPath: path.join(dir, `${id}.meta.json`),
  };
}

class LocalStoredFile {
  constructor(
    private readonly filePath: string,
    private readonly metaPath: string,
  ) {}

  async exists(): Promise<[boolean]> {
    try {
      await fsp.access(this.filePath);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata(): Promise<[{ contentType?: string; size?: number }]> {
    const stat = await fsp.stat(this.filePath);
    let contentType: string | undefined;
    try {
      const meta = JSON.parse(await fsp.readFile(this.metaPath, "utf8")) as { contentType?: string };
      contentType = typeof meta.contentType === "string" ? meta.contentType : undefined;
    } catch {
      contentType = undefined;
    }
    return [{ contentType, size: stat.size }];
  }

  createReadStream(): Readable {
    return fs.createReadStream(this.filePath);
  }
}

export type StoredObjectFile = File | LocalStoredFile;

export class ObjectStorageService {
  isLocal(): boolean {
    return !usesReplitObjectStorage();
  }

  private privateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR?.trim();
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return dir;
  }

  private publicSearchPaths(): string[] {
    const paths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "")
      .split(",").map((searchPath) => searchPath.trim()).filter(Boolean);
    if (!paths.length) throw new Error("PUBLIC_OBJECT_SEARCH_PATHS is not configured");
    return [...new Set(paths)];
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const objectPath = `/objects/uploads/${randomUUID()}`;
    return this.getObjectEntityUploadURLForPath(objectPath);
  }

  async createObjectEntityUpload(): Promise<{ uploadURL: string; objectPath: string }> {
    const objectPath = `/objects/uploads/${randomUUID()}`;
    const uploadURL = await this.getObjectEntityUploadURLForPath(objectPath);
    return { uploadURL, objectPath };
  }

  private async getObjectEntityUploadURLForPath(objectPath: string): Promise<string> {
    if (!LOCAL_OBJECT_ID.test(objectPath)) {
      throw new Error("Invalid object entity path");
    }
    if (this.isLocal()) {
      const id = objectPath.slice("/objects/uploads/".length);
      return `${localApiOrigin()}/api/storage/local-upload/${id}`;
    }
    const objectStoragePath = `${this.privateObjectDir()}/${objectPath.slice("/objects/".length)}`;
    const { bucketName, objectName } = parseObjectPath(objectStoragePath);
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method: "PUT",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Failed to sign object URL (${response.status})`);
    const body = await response.json() as { signed_url?: string };
    if (!body.signed_url) throw new Error("Object storage returned no upload URL");
    return body.signed_url;
  }

  async writeLocalObject(objectPath: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.isLocal() || !LOCAL_OBJECT_ID.test(objectPath)) {
      throw new Error("Invalid local object path");
    }
    const { filePath, metaPath } = localObjectPaths(objectPath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, body);
    await fsp.writeFile(metaPath, JSON.stringify({ contentType }));
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const objectDir = `${this.privateObjectDir().replace(/\/+$/, "")}/`;
    const pathname = new URL(rawPath).pathname;
    if (!pathname.startsWith(objectDir)) return pathname;
    return `/objects/${pathname.slice(objectDir.length)}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObjectFile> {
    if (!LOCAL_OBJECT_ID.test(objectPath)) {
      throw new ObjectNotFoundError();
    }
    if (this.isLocal()) {
      const { filePath, metaPath } = localObjectPaths(objectPath);
      const file = new LocalStoredFile(filePath, metaPath);
      const [exists] = await file.exists();
      if (!exists) throw new ObjectNotFoundError();
      return file;
    }
    const entityId = objectPath.slice("/objects/".length);
    const { bucketName, objectName } = parseObjectPath(`${this.privateObjectDir()}/${entityId}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async getObjectMetadata(objectPath: string): Promise<{ contentType?: string; size?: number }> {
    const file = await this.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    return {
      contentType: typeof metadata.contentType === "string" ? metadata.contentType.toLowerCase() : undefined,
      size: metadata.size ? Number(metadata.size) : undefined,
    };
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    if (!LOCAL_OBJECT_ID.test(objectPath)) {
      throw new ObjectNotFoundError();
    }
    if (this.isLocal()) {
      const { filePath, metaPath } = localObjectPaths(objectPath);
      await fsp.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fsp.unlink(metaPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      return;
    }
    const entityId = objectPath.slice("/objects/".length);
    const { bucketName, objectName } = parseObjectPath(`${this.privateObjectDir()}/${entityId}`);
    await objectStorageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
  }

  async findPublicObject(filePath: string): Promise<StoredObjectFile | null> {
    if (this.isLocal()) {
      const safe = filePath.replace(/^\/+/, "");
      const localPath = path.join(localStorageRoot(), "public", safe);
      if (!localPath.startsWith(path.join(localStorageRoot(), "public"))) return null;
      const file = new LocalStoredFile(localPath, `${localPath}.meta.json`);
      const [exists] = await file.exists();
      return exists ? file : null;
    }
    for (const searchPath of this.publicSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(`${searchPath}/${filePath}`);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }
}

function parseObjectPath(objectPath: string): { bucketName: string; objectName: string } {
  const normalized = objectPath.startsWith("/") ? objectPath : `/${objectPath}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid object storage path");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}
