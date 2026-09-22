import assert from "node:assert/strict";
import test from "node:test";
import {
  uploadProfilePhoto,
} from "../lib/profile-photo-upload.ts";

test("native profile photo upload uses a local file body and the presigned upload metadata", async () => {
  const localUri = "file:///var/mobile/Containers/Data/Application/profile-photo.webp";
  const fileSize = 82_341;
  const calls = [];
  let browserBlobReads = 0;

  const upload = await uploadProfilePhoto({
    uri: localUri,
    mimeType: "image/webp",
    fileName: "member-profile.webp",
  }, {
    platform: "ios",
    createNativeFile(uri) {
      calls.push({ kind: "native-file", uri });
      return { size: fileSize };
    },
    readWebBlob() {
      browserBlobReads += 1;
      throw new Error("native uploads must not create a browser Blob");
    },
    async requestUpload(metadata) {
      calls.push({ kind: "request-url", metadata });
      return {
        uploadURL: "https://storage.example.test/profile-photo-upload",
        objectPath: "/objects/uploads/member-profile.webp",
      };
    },
    async put(url, options) {
      calls.push({ kind: "put", url, options });
      return { ok: true };
    },
  });

  assert.deepEqual(upload, {
    uploadURL: "https://storage.example.test/profile-photo-upload",
    objectPath: "/objects/uploads/member-profile.webp",
  });
  assert.deepEqual(calls, [
    { kind: "native-file", uri: localUri },
    {
      kind: "request-url",
      metadata: {
        name: "member-profile.webp",
        size: fileSize,
        contentType: "image/webp",
      },
    },
    {
      kind: "put",
      url: "https://storage.example.test/profile-photo-upload",
      options: {
        method: "PUT",
        headers: { "Content-Type": "image/webp" },
        body: { size: fileSize },
      },
    },
  ]);
  assert.equal(browserBlobReads, 0);
});