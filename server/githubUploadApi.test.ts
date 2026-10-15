import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  authenticateAgentToken: vi.fn(),
  listRepositories: vi.fn(),
  getOwnedRepository: vi.fn(),
  getArchiveDownload: vi.fn(),
  addAgentMessage: vi.fn(),
}));

vi.mock("./workspace", () => mocks);
import { registerGithubUploadApi } from "./githubUploadApi";

const repository = {
  id: "repo_123",
  name: "demo-project",
  description: "A test project",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  currentVersionId: "version_1",
};

let server: ReturnType<ReturnType<typeof express>['listen']>;
let baseUrl: string;

beforeEach(async () => {
  const app = express();
  registerGithubUploadApi(app);
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/github-upload/v1`;
  mocks.authenticateAgentToken.mockReset();
  mocks.listRepositories.mockReset();
  mocks.getOwnedRepository.mockReset();
  mocks.getArchiveDownload.mockReset();
  mocks.addAgentMessage.mockReset();
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("GitHub export key scope", () => {
  it("rejects a missing or invalid bearer token", async () => {
    mocks.authenticateAgentToken.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/repositories`);
    expect(response.status).toBe(401);
    expect(mocks.listRepositories).not.toHaveBeenCalled();
  });

  it("rejects a full Wasl key on the GitHub-only API", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "full", scope: "full" });
    const response = await fetch(`${baseUrl}/repositories`, { headers: { Authorization: "Bearer wasl_ak_example" } });
    expect(response.status).toBe(403);
    expect(mocks.listRepositories).not.toHaveBeenCalled();
  });

  it("rejects a repository-edit key on the GitHub-only API", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "single-project", scope: "repository_edit", scopedRepositoryId: "repo_123" });
    const response = await fetch(`${baseUrl}/repositories`, { headers: { Authorization: "Bearer wasl_re_example" } });
    expect(response.status).toBe(403);
    expect(mocks.listRepositories).not.toHaveBeenCalled();
  });

  it("lists only the owner's exportable repositories", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "publisher", scope: "github_upload" });
    mocks.listRepositories.mockResolvedValue([repository]);
    const response = await fetch(`${baseUrl}/repositories`, { headers: { Authorization: "Bearer wasl_gh_example" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ repositories: [{ id: "repo_123", name: "demo-project", hasArchive: true }] });
    expect(mocks.listRepositories).toHaveBeenCalledWith(7);
  });

  it("returns a temporary archive URL only after checking repository ownership", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "publisher", scope: "github_upload" });
    mocks.getOwnedRepository.mockResolvedValue(repository);
    mocks.getArchiveDownload.mockResolvedValue({ archiveName: "demo.zip", sizeBytes: 1024, versionNumber: 2, url: "https://storage.example/signed" });
    const response = await fetch(`${baseUrl}/repositories/repo_123/archive`, { headers: { Authorization: "Bearer wasl_gh_example" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ archiveName: "demo.zip", versionNumber: 2, downloadUrl: "https://storage.example/signed" });
    expect(mocks.getOwnedRepository).toHaveBeenCalledWith(7, "repo_123");
    expect(mocks.getArchiveDownload).toHaveBeenCalledWith(7, "repo_123");
  });

  it("records a validated GitHub publishing result", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "publisher", scope: "github_upload" });
    mocks.getOwnedRepository.mockResolvedValue(repository);
    const response = await fetch(`${baseUrl}/repositories/repo_123/publish-result`, {
      method: "POST",
      headers: { Authorization: "Bearer wasl_gh_example", "Content-Type": "application/json" },
      body: JSON.stringify({ githubUrl: "https://github.com/acme/demo", branch: "main", commitSha: "a1b2c3d4e5f6789" }),
    });
    expect(response.status).toBe(201);
    expect(mocks.addAgentMessage).toHaveBeenCalledWith("repo_123", undefined, "publisher", expect.stringContaining("https://github.com/acme/demo"));
  });

  it.each([
    ["external host", "https://evil.example/acme/demo"],
    ["encoded slash", "https://github.com/acme/re%2Fpo"],
    ["encoded space", "https://github.com/acme/re%20po"],
    ["non-standard port", "https://github.com:444/acme/demo"],
  ])("rejects unsafe repository URLs (%s)", async (_reason, githubUrl) => {
    mocks.authenticateAgentToken.mockResolvedValue({ ownerId: 7, label: "publisher", scope: "github_upload" });
    mocks.getOwnedRepository.mockResolvedValue(repository);
    const response = await fetch(`${baseUrl}/repositories/repo_123/publish-result`, {
      method: "POST",
      headers: { Authorization: "Bearer wasl_gh_example", "Content-Type": "application/json" },
      body: JSON.stringify({ githubUrl, branch: "main", commitSha: "a1b2c3d4e5f6789" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.addAgentMessage).not.toHaveBeenCalled();
  });
});
