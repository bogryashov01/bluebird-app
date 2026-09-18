import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

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

export class ObjectStorageService {
  private privateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR?.trim();
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return dir;
  }

  private publicSearchPaths(): string[] {
    const paths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "")
      .split(",").map((path) => path.trim()).filter(Boolean);
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
    if (!/^\/objects\/uploads\/[A-Za-z0-9-]+$/.test(objectPath)) {
      throw new Error("Invalid object entity path");
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

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;
    const objectDir = `${this.privateObjectDir().replace(/\/+$/, "")}/`;
    const pathname = new URL(rawPath).pathname;
    if (!pathname.startsWith(objectDir)) return pathname;
    return `/objects/${pathname.slice(objectDir.length)}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!/^\/objects\/uploads\/[A-Za-z0-9-]+$/.test(objectPath)) {
      throw new ObjectNotFoundError();
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
    if (!/^\/objects\/uploads\/[A-Za-z0-9-]+$/.test(objectPath)) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice("/objects/".length);
    const { bucketName, objectName } = parseObjectPath(`${this.privateObjectDir()}/${entityId}`);
    await objectStorageClient.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
  }

  async findPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.publicSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(`${searchPath}/${filePath}`);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid object storage path");
  }
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}