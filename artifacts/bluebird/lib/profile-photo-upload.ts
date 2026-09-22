export type ProfilePhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ProfilePhotoAsset {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

export interface ProfilePhotoNativeFile {
  size: number | null;
}

export interface ProfilePhotoUploadMetadata {
  name: string;
  size: number;
  contentType: ProfilePhotoContentType;
}

export interface ProfilePhotoUploadResponse {
  uploadURL: string;
  objectPath: string;
}

export interface ProfilePhotoUploadDependencies {
  platform: string;
  createNativeFile: (uri: string) => ProfilePhotoNativeFile;
  readWebBlob: (uri: string) => Promise<{ size: number }>;
  requestUpload: (metadata: ProfilePhotoUploadMetadata) => Promise<ProfilePhotoUploadResponse>;
  put: (url: string, options: {
    method: 'PUT';
    headers: { 'Content-Type': ProfilePhotoContentType };
    body: unknown;
  }) => Promise<{ ok: boolean }>;
}

export async function uploadProfilePhoto(
  asset: ProfilePhotoAsset,
  dependencies: ProfilePhotoUploadDependencies,
): Promise<ProfilePhotoUploadResponse> {
  const contentType = asset.mimeType?.toLowerCase() as ProfilePhotoContentType | undefined;
  if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('Choose a JPEG, PNG, or WebP profile photo.');
  }

  let body: unknown;
  let size = asset.fileSize ?? undefined;
  if (dependencies.platform === 'web') {
    const blob = await dependencies.readWebBlob(asset.uri);
    body = blob;
    size ??= blob.size;
  } else {
    const file = dependencies.createNativeFile(asset.uri);
    body = file;
    size ??= file.size ?? undefined;
  }

  if (!size || size > 1_500_000) {
    throw new Error('Profile photos must be smaller than 1.5 MB.');
  }

  const metadata: ProfilePhotoUploadMetadata = {
    name: asset.fileName ?? `profile.${contentType.slice('image/'.length).replace('jpeg', 'jpg')}`,
    size,
    contentType,
  };
  const upload = await dependencies.requestUpload(metadata);
  const response = await dependencies.put(upload.uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!response.ok) throw new Error('Photo upload failed');
  return upload;
}