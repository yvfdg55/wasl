import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  MAX_ARCHIVE_BYTES: 25 * 1024 * 1024,
  authenticateAgentToken: vi.fn(),
  getOwnedRepository: vi.fn(),
  getOrCreateUploadKeyRepository: vi.fn(),
  getArchiveDownload: vi.fn(),
  isValidZipStructure: vi.fn(),
  saveArchive: vi.fn(),
}));

vi.mock("./workspace", () => mocks);
import { registerRepositoryUploadApi } from "./repositoryUploadApi";

const repository = {
  id: "repo_123",
  ownerId: 7,
  name: "first-project",
  description: "Uploaded by an agent",
  currentVersionId: "version_1",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};
const key = { id: "key_123", ownerId: 7, label: "uploader", scope: "repository_upload", scopedRepositoryId: null };

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  const app = express();
  registerRepositoryUploadApi(app);
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/repository-upload/v1`;
  for (const mock of [mocks.authenticateAgentToken, mocks.getOwnedRepository, mocks.getOrCreateUploadKeyRepository, mocks.getArchiveDownload, mocks.isValidZipStructure, mocks.saveArchive]) mock.mockReset();
  mocks.authenticateAgentToken.mockResolvedValue(key);
  mocks.isValidZipStructure.mockReturnValue(true);
  mocks.getOwnedRepository.mockResolvedValue(repository);
  mocks.getOrCreateUploadKeyRepository.mockResolvedValue({ repository, created: true });
  mocks.saveArchive.mockResolvedValue({ versionId: "version_1", versionNumber: 1, archiveName: "first-project.zip", sizeBytes: 128 });
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

const auth = { Authorization: "Bearer wasl_up_test" };
const emptyZip = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);

describe("repository-upload key scope", () => {
  it("rejects a missing or invalid bearer token", async () => {
    mocks.authenticateAgentToken.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/repository`, { headers: auth });
    expect(response.status).toBe(401);
    expect(mocks.getOrCreateUploadKeyRepository).not.toHaveBeenCalled();
  });

  it.each(["full", "github_upload", "repository_edit"])("rejects the %s key", async scope => {
    mocks.authenticateAgentToken.mockResolvedValue({ ...key, scope, scopedRepositoryId: scope === "repository_edit" ? "repo_123" : null });
    const response = await fetch(`${baseUrl}/repository`, { headers: auth });
    expect(response.status).toBe(403);
  });

  it("reports that an unbound key is waiting for its first upload", async () => {
    const response = await fetch(`${baseUrl}/repository`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ bound: false, repository: null });
    expect(mocks.getOwnedRepository).not.toHaveBeenCalled();
  });

  it("creates and binds one project on the first valid ZIP upload", async () => {
    const response = await fetch(`${baseUrl}/repository/archive`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/zip", "X-Repository-Name": "first-project", "X-Repository-Description": "Uploaded%20by%20an%20agent" },
      body: emptyZip,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, createdRepository: true, repository: { id: "repo_123" } });
    expect(mocks.getOrCreateUploadKeyRepository).toHaveBeenCalledWith({
      apiKeyId: "key_123", ownerId: 7, name: "first-project", description: "Uploaded by an agent", actorName: "uploader",
    });
    expect(mocks.saveArchive).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 7, repositoryId: "repo_123", actorType: "agent" }));
  });

  it("does not create a project when the ZIP is invalid", async () => {
    mocks.isValidZipStructure.mockReturnValue(false);
    const response = await fetch(`${baseUrl}/repository/archive`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/zip", "X-Repository-Name": "invalid" }, body: emptyZip,
    });
    expect(response.status).toBe(400);
    expect(mocks.getOrCreateUploadKeyRepository).not.toHaveBeenCalled();
    expect(mocks.saveArchive).not.toHaveBeenCalled();
  });

  it("rejects an unbound first upload without a project name", async () => {
    mocks.getOrCreateUploadKeyRepository.mockRejectedValue(new Error("اسم المستودع مطلوب عند أول رفع"));
    const response = await fetch(`${baseUrl}/repository/archive`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: emptyZip,
    });
    expect(response.status).toBe(400);
    expect(mocks.saveArchive).not.toHaveBeenCalled();
  });

  it("uploads future versions to the stored project and ignores caller project ids", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ...key, scopedRepositoryId: "repo_123" });
    mocks.getOrCreateUploadKeyRepository.mockResolvedValue({ repository: { ...repository, currentVersionId: "version_2" }, created: false });
    const response = await fetch(`${baseUrl}/repository/archive?repositoryId=another-project`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: emptyZip,
    });
    expect(response.status).toBe(201);
    expect(mocks.getOrCreateUploadKeyRepository).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: "key_123", ownerId: 7 }));
    expect(mocks.getOrCreateUploadKeyRepository.mock.calls[0][0]).not.toHaveProperty("repositoryId");
    expect(mocks.saveArchive).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "repo_123" }));
  });

  it("returns a temporary archive download only for the key-bound project", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ...key, scopedRepositoryId: "repo_123" });
    mocks.getArchiveDownload.mockResolvedValue({ archiveName: "first-project.zip", sizeBytes: 1024, versionNumber: 2, url: "https://storage.example/signed" });
    const response = await fetch(`${baseUrl}/repository/archive`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ archiveName: "first-project.zip", versionNumber: 2, downloadUrl: "https://storage.example/signed" });
    expect(mocks.getArchiveDownload).toHaveBeenCalledWith(7, "repo_123");
  });

  it("allows only reading and downloading the linked project, with no extra routes", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ...key, scopedRepositoryId: "repo_123" });
    const response = await fetch(`${baseUrl}/repository`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ bound: true, repository: { id: "repo_123" } });
    expect(mocks.getOwnedRepository).toHaveBeenCalledWith(7, "repo_123", true);
    const forbidden = await fetch(`${baseUrl}/repositories`, { headers: auth });
    expect(forbidden.status).toBe(404);
  });

  it("rejects use of an archived linked repository without allowing rebinding", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ...key, scopedRepositoryId: "repo_123" });
    mocks.getOrCreateUploadKeyRepository.mockResolvedValue({ repository: { ...repository, archivedAt: new Date() }, created: false });
    const response = await fetch(`${baseUrl}/repository/archive`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: emptyZip,
    });
    expect(response.status).toBe(410);
    expect(mocks.saveArchive).not.toHaveBeenCalled();
  });
});
