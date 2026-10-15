import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  MAX_ARCHIVE_BYTES: 25 * 1024 * 1024,
  authenticateAgentToken: vi.fn(),
  getOwnedRepository: vi.fn(),
  getArchiveDownload: vi.fn(),
  saveArchive: vi.fn(),
  listVersions: vi.fn(),
  restoreVersion: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  listActivities: vi.fn(),
  addAgentMessage: vi.fn(),
  updateRepository: vi.fn(),
}));

vi.mock("./workspace", () => mocks);
import { registerRepositoryAgentApi } from "./repositoryAgentApi";

const repository = {
  id: "repo_123",
  ownerId: 7,
  name: "single-project",
  description: "Scoped test project",
  currentVersionId: "version_1",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;

beforeEach(async () => {
  const app = express();
  registerRepositoryAgentApi(app);
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/repository-agent/v1`;
  for (const mock of [mocks.authenticateAgentToken, mocks.getOwnedRepository, mocks.getArchiveDownload, mocks.saveArchive, mocks.listVersions, mocks.restoreVersion, mocks.listTasks, mocks.createTask, mocks.updateTask, mocks.listActivities, mocks.addAgentMessage, mocks.updateRepository]) mock.mockReset();
  mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "scoped-agent", scope: "repository_edit", scopedRepositoryId: "repo_123" });
  mocks.getOwnedRepository.mockResolvedValue(repository);
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("single-repository agent key", () => {
  it("rejects a missing or invalid bearer token", async () => {
    mocks.authenticateAgentToken.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/repository`);
    expect(response.status).toBe(401);
    expect(mocks.getOwnedRepository).not.toHaveBeenCalled();
  });

  it.each([
    ["full", null],
    ["github_upload", null],
    ["repository_edit", null],
  ])("rejects a key without the repository-edit scope or repository binding", async (scope, scopedRepositoryId) => {
    mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "wrong-scope", scope, scopedRepositoryId });
    const response = await fetch(`${baseUrl}/repository`, { headers: { Authorization: "Bearer wasl_test" } });
    expect(response.status).toBe(403);
    expect(mocks.getOwnedRepository).not.toHaveBeenCalled();
  });

  it("returns only the repository bound to the key and ignores a caller-supplied id", async () => {
    const response = await fetch(`${baseUrl}/repository?repositoryId=another-repo`, {
      headers: { Authorization: "Bearer wasl_re_test" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ repository: { id: "repo_123", name: "single-project" } });
    expect(mocks.getOwnedRepository).toHaveBeenCalledWith(7, "repo_123");
    expect(mocks.getOwnedRepository).not.toHaveBeenCalledWith(7, "another-repo");
  });

  it("rejects the key after its repository has been archived", async () => {
    mocks.getOwnedRepository.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/repository`, { headers: { Authorization: "Bearer wasl_re_test" } });
    expect(response.status).toBe(404);
    expect(mocks.getOwnedRepository).toHaveBeenCalledWith(7, "repo_123");
  });

  it("updates the repository bound to the key, not an id supplied in the body", async () => {
    mocks.updateRepository.mockResolvedValue({ ...repository, name: "updated-name" });
    const response = await fetch(`${baseUrl}/repository`, {
      method: "PATCH",
      headers: { Authorization: "Bearer wasl_re_test", "Content-Type": "application/json" },
      body: JSON.stringify({ repositoryId: "another-repo", name: "updated-name" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.updateRepository).toHaveBeenCalledWith(7, "repo_123", { name: "updated-name", description: undefined }, "agent", "scoped-agent");
  });

  it("uploads a new ZIP version only to the repository bound to the key", async () => {
    mocks.saveArchive.mockResolvedValue({ versionNumber: 2, versionId: "version_2" });
    const response = await fetch(`${baseUrl}/repository/archive`, {
      method: "POST",
      headers: { Authorization: "Bearer wasl_re_test", "Content-Type": "application/zip", "X-Archive-Name": "project.zip" },
      body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    expect(response.status).toBe(201);
    expect(mocks.saveArchive).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 7,
      repositoryId: "repo_123",
      actorType: "agent",
      actorName: "scoped-agent",
    }));
  });

  it("does not expose full-account repository routes", async () => {
    const response = await fetch(`${baseUrl}/repositories/another-repo/archive`, {
      headers: { Authorization: "Bearer wasl_re_test" },
    });
    expect(response.status).toBe(404);
  });
});
