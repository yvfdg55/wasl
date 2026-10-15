import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { addAgentMessage, authenticateAgentToken, getArchiveDownload, getOwnedRepository, listRepositories } from "./workspace";

const api = express.Router();
type GithubUploadRequest = Request & { agentOwnerId?: number; agentLabel?: string };
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };

api.use(express.json({ limit: "1mb" }));
api.use(asyncRoute(async (req, res, next) => {
  const authorization = req.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const key = token ? await authenticateAgentToken(token) : null;
  if (!key) {
    res.status(401).json({ error: "مفتاح تصدير GitHub غير صالح أو ملغى" });
    return;
  }
  if (key.scope !== "github_upload") {
    const endpoint = key.scope === "full" ? "/api/agents/v1" : "/api/repository-agent/v1";
    res.status(403).json({ error: `هذا المفتاح غير مخصص لتصدير GitHub؛ استخدم ${endpoint}`, code: "wrong_key_scope" });
    return;
  }
  (req as GithubUploadRequest).agentOwnerId = key.ownerId;
  (req as GithubUploadRequest).agentLabel = key.label;
  next();
}));

function owner(req: Request) {
  const scoped = req as GithubUploadRequest;
  return { id: scoped.agentOwnerId!, label: scoped.agentLabel! };
}

async function requireActiveRepository(ownerId: number, repositoryId: string, res: Response) {
  const repository = await getOwnedRepository(ownerId, repositoryId);
  if (!repository) res.status(404).json({ error: "المستودع غير موجود أو لا تملك صلاحية تصديره" });
  return repository;
}

api.get("/repositories", asyncRoute(async (req, res) => {
  const { id } = owner(req);
  const repositories = await listRepositories(id);
  res.json({ repositories: repositories.map(repository => ({
    id: repository.id,
    name: repository.name,
    description: repository.description,
    updatedAt: repository.updatedAt,
    hasArchive: Boolean(repository.currentVersionId),
  })) });
}));

api.get("/repositories/:repositoryId/archive", asyncRoute(async (req, res) => {
  const { id } = owner(req);
  const repository = await requireActiveRepository(id, req.params.repositoryId, res);
  if (!repository) return;
  try {
    const archive = await getArchiveDownload(id, repository.id);
    res.json({
      repository: { id: repository.id, name: repository.name },
      archiveName: archive.archiveName,
      sizeBytes: archive.sizeBytes,
      versionNumber: archive.versionNumber,
      downloadUrl: archive.url,
    });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "لا توجد نسخة قابلة للتنزيل" });
  }
}));

api.post("/repositories/:repositoryId/publish-result", asyncRoute(async (req, res) => {
  const { id, label } = owner(req);
  const repository = await requireActiveRepository(id, req.params.repositoryId, res);
  if (!repository) return;

  const githubUrl = typeof req.body?.githubUrl === "string" ? req.body.githubUrl.trim() : "";
  const branch = typeof req.body?.branch === "string" ? req.body.branch.trim() : "";
  const commitSha = typeof req.body?.commitSha === "string" ? req.body.commitSha.trim() : "";
  const unsafeUrlCharacters = /[\u0000-\u0020\u007f\\]/.test(githubUrl);
  let parsed: URL;
  try { parsed = new URL(githubUrl); } catch { res.status(400).json({ error: "رابط GitHub غير صالح" }); return; }
  const repoPath = parsed.pathname.replace(/\/$/, "");
  const pathParts = repoPath.split("/").slice(1);
  const [ownerSlug, repositorySlug] = pathParts;
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(ownerSlug ?? "");
  const validRepository = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repositorySlug ?? "") && repositorySlug !== "." && repositorySlug !== "..";
  if (unsafeUrlCharacters || parsed.protocol !== "https:" || parsed.origin !== "https://github.com" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.includes("%") || pathParts.length !== 2 || !validOwner || !validRepository) {
    res.status(400).json({ error: "استخدم رابط مستودع GitHub بالشكل https://github.com/owner/repo" });
    return;
  }
  if (!branch || branch.length > 255 || /[\u0000-\u001f\u007f]/.test(branch)) {
    res.status(400).json({ error: "اسم الفرع مطلوب وبحد أقصى 255 حرفًا" });
    return;
  }
  if (!/^[a-fA-F0-9]{7,64}$/.test(commitSha)) {
    res.status(400).json({ error: "commit SHA غير صالح" });
    return;
  }

  const normalizedUrl = `https://github.com/${ownerSlug}/${repositorySlug}`;
  await addAgentMessage(repository.id, undefined, label, `رفع وكيل وصل المشروع إلى ${normalizedUrl} · الفرع ${branch} · commit ${commitSha}`);
  res.status(201).json({ success: true, recorded: { githubUrl: normalizedUrl, branch, commitSha } });
}));

export function registerGithubUploadApi(app: Express) {
  app.use("/api/github-upload/v1", api);
}
