import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import {
  MAX_ARCHIVE_BYTES,
  authenticateAgentToken,
  getOwnedRepository,
  getOrCreateUploadKeyRepository,
  getArchiveDownload,
  isValidZipStructure,
  saveArchive,
} from "./workspace";

const api = express.Router();
type RepositoryUploadRequest = Request & {
  apiKeyId?: string;
  agentOwnerId?: number;
  agentLabel?: string;
  scopedRepositoryId?: string | null;
};
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };

api.use(asyncRoute(async (req, res, next) => {
  const authorization = req.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const key = token ? await authenticateAgentToken(token) : null;
  if (!key) {
    res.status(401).json({ error: "مفتاح الرفع غير صالح أو ملغى" });
    return;
  }
  if (key.scope !== "repository_upload") {
    res.status(403).json({ error: "هذا المفتاح ليس مخصصًا لرفع مستودع واحد إلى وصل", code: "wrong_key_scope" });
    return;
  }
  const scoped = req as RepositoryUploadRequest;
  scoped.apiKeyId = key.id;
  scoped.agentOwnerId = key.ownerId;
  scoped.agentLabel = key.label;
  scoped.scopedRepositoryId = key.scopedRepositoryId;
  next();
}));

function identity(req: Request) {
  const scoped = req as RepositoryUploadRequest;
  return {
    apiKeyId: scoped.apiKeyId!,
    ownerId: scoped.agentOwnerId!,
    label: scoped.agentLabel!,
    repositoryId: scoped.scopedRepositoryId,
  };
}

function decodeHeader(value?: string) {
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return value; }
}

function publicRepository(repository: NonNullable<Awaited<ReturnType<typeof getOwnedRepository>>>) {
  return {
    id: repository.id,
    name: repository.name,
    description: repository.description,
    currentVersionId: repository.currentVersionId,
    archivedAt: repository.archivedAt,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  };
}

async function uploadTarget(ownerId: number, repositoryId?: string | null) {
  if (!repositoryId) return null;
  return getOwnedRepository(ownerId, repositoryId, true);
}

api.get("/repository", asyncRoute(async (req, res) => {
  const { ownerId, repositoryId } = identity(req);
  const repository = await uploadTarget(ownerId, repositoryId);
  if (!repositoryId) {
    res.json({ bound: false, repository: null, message: "ارفع ZIP أولًا لإنشاء مستودع وصل وربط المفتاح به" });
    return;
  }
  if (!repository) {
    res.status(404).json({ error: "المستودع المرتبط بمفتاح الرفع غير موجود" });
    return;
  }
  res.json({ bound: true, archived: !!repository.archivedAt, repository: publicRepository(repository) });
}));

api.get("/repository/archive", asyncRoute(async (req, res) => {
  const { ownerId, repositoryId } = identity(req);
  if (!repositoryId) {
    res.status(409).json({ error: "لم يُنشأ المستودع بعد؛ ارفع ZIP أولًا مع X-Repository-Name" });
    return;
  }
  const repository = await uploadTarget(ownerId, repositoryId);
  if (!repository) { res.status(404).json({ error: "المستودع المرتبط بمفتاح الرفع غير موجود" }); return; }
  if (repository.archivedAt) {
    res.status(410).json({ error: "المستودع المرتبط مؤرشف ولا يمكن استخدام مفتاح الرفع", repositoryName: repository.name });
    return;
  }
  try {
    const archive = await getArchiveDownload(ownerId, repository.id);
    res.json({ archiveName: archive.archiveName, sizeBytes: archive.sizeBytes, versionNumber: archive.versionNumber, downloadUrl: archive.url });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "لا يوجد أرشيف لهذا المستودع" });
  }
}));

const parseZipBody = express.raw({ type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"], limit: MAX_ARCHIVE_BYTES });
api.post("/repository/archive", (req, res, next) => {
  parseZipBody(req, res, error => {
    if (!error) { next(); return; }
    const tooLarge = (error as NodeJS.ErrnoException & { type?: string }).type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "حجم الملف يتجاوز الحد الأعلى 25 ميغابايت" : "تعذر قراءة ملف ZIP" });
  });
}, asyncRoute(async (req, res) => {
  const { apiKeyId, ownerId, label } = identity(req);
  if (!Buffer.isBuffer(req.body)) { res.status(415).json({ error: "أرسل أرشيف ZIP بصيغة application/zip" }); return; }
  if (!req.body.length || req.body.length > MAX_ARCHIVE_BYTES) { res.status(400).json({ error: "حجم الملف يجب أن يكون بين 1 بايت و25 ميغابايت" }); return; }
  if (!isValidZipStructure(req.body)) { res.status(400).json({ error: "الأرشيف ZIP غير مكتمل أو غير صالح" }); return; }

  const rawName = decodeHeader(req.header("x-repository-name"));
  const rawDescription = decodeHeader(req.header("x-repository-description"));
  const name = rawName?.trim();
  const description = rawDescription?.trim();
  if (name && (name.length > 120 || !name)) { res.status(400).json({ error: "اسم المستودع يجب ألا يتجاوز 120 حرفًا" }); return; }
  if (description && description.length > 2000) { res.status(400).json({ error: "وصف المستودع يجب ألا يتجاوز 2000 حرف" }); return; }

  try {
    const { repository, created } = await getOrCreateUploadKeyRepository({
      apiKeyId, ownerId, name, description, actorName: label,
    });
    if (repository.archivedAt) {
      res.status(410).json({ error: "المستودع المرتبط مؤرشف؛ لا يمكن لمفتاح الرفع إنشاء مستودع بديل", repositoryName: repository.name });
      return;
    }
    const archiveName = req.header("x-archive-name") || `${repository.name}.zip`;
    const version = await saveArchive({
      ownerId, repositoryId: repository.id, data: req.body, archiveName, actorType: "agent", actorName: label,
    });
    res.status(201).json({ success: true, createdRepository: created, repository: publicRepository(repository), version });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر رفع الأرشيف" });
  }
}));

export function registerRepositoryUploadApi(app: Express) {
  app.use("/api/repository-upload/v1", api);
}
