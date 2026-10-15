import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import {
  MAX_ARCHIVE_BYTES,
  addAgentMessage,
  authenticateAgentToken,
  createTask,
  getArchiveDownload,
  getOwnedRepository,
  listActivities,
  listTasks,
  listVersions,
  restoreVersion,
  saveArchive,
  updateRepository,
  updateTask,
} from "./workspace";

const api = express.Router();
type RepositoryAgentRequest = Request & {
  agentOwnerId?: number;
  agentLabel?: string;
  scopedRepositoryId?: string;
};
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };

api.use(express.json({ limit: "1mb" }));
api.use(asyncRoute(async (req, res, next) => {
  const authorization = req.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const key = token ? await authenticateAgentToken(token) : null;
  if (!key) {
    res.status(401).json({ error: "مفتاح المستودع غير صالح أو ملغى" });
    return;
  }
  if (key.scope !== "repository_edit" || !key.scopedRepositoryId) {
    res.status(403).json({ error: "هذا المفتاح غير مخصص لتعديل مستودع واحد", code: "wrong_key_scope" });
    return;
  }
  const repository = await getOwnedRepository(key.ownerId, key.scopedRepositoryId);
  if (!repository) {
    res.status(404).json({ error: "المستودع المحدد غير موجود أو مؤرشف" });
    return;
  }
  const scoped = req as RepositoryAgentRequest;
  scoped.agentOwnerId = key.ownerId;
  scoped.agentLabel = key.label;
  scoped.scopedRepositoryId = key.scopedRepositoryId;
  next();
}));

function identity(req: Request) {
  const scoped = req as RepositoryAgentRequest;
  return {
    ownerId: scoped.agentOwnerId!,
    label: scoped.agentLabel!,
    repositoryId: scoped.scopedRepositoryId!,
  };
}

async function requireRepository(req: Request, res: Response) {
  const { ownerId, repositoryId } = identity(req);
  const repository = await getOwnedRepository(ownerId, repositoryId);
  if (!repository) res.status(404).json({ error: "المستودع المحدد غير موجود أو مؤرشف" });
  return repository;
}

const zipBody = express.raw({
  type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
  limit: MAX_ARCHIVE_BYTES,
});

api.get("/repository", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  res.json({ repository: {
    id: repository.id,
    name: repository.name,
    description: repository.description,
    currentVersionId: repository.currentVersionId,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  } });
}));

api.patch("/repository", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { ownerId, label, repositoryId } = identity(req);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
  const description = typeof req.body?.description === "string" || req.body?.description === null ? req.body.description : undefined;
  if (name !== undefined && (!name || name.length > 120)) {
    res.status(400).json({ error: "اسم المستودع غير صالح" });
    return;
  }
  if (description !== undefined && description !== null && description.length > 2000) {
    res.status(400).json({ error: "وصف المستودع يتجاوز 2000 حرف" });
    return;
  }
  try {
    const updated = await updateRepository(ownerId, repositoryId, { name, description }, "agent", label);
    res.json({ repository: { id: updated.id, name: updated.name, description: updated.description, updatedAt: updated.updatedAt } });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر تحديث المستودع" });
  }
}));

api.get("/repository/archive", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { ownerId, repositoryId } = identity(req);
  try {
    const archive = await getArchiveDownload(ownerId, repositoryId);
    res.json({ archiveName: archive.archiveName, sizeBytes: archive.sizeBytes, versionNumber: archive.versionNumber, downloadUrl: archive.url });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "لا توجد نسخة قابلة للتنزيل" });
  }
}));

api.post("/repository/archive", zipBody, asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  if (!Buffer.isBuffer(req.body)) {
    res.status(415).json({ error: "أرسل الأرشيف بصيغة application/zip" });
    return;
  }
  const { ownerId, label, repositoryId } = identity(req);
  let archiveName = req.header("x-archive-name") || `${repository.name}.zip`;
  try { archiveName = decodeURIComponent(archiveName); } catch { /* keep the supplied name */ }
  try {
    const version = await saveArchive({ ownerId, repositoryId, data: req.body, archiveName, actorType: "agent", actorName: label });
    res.status(201).json({ success: true, version });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر رفع نسخة المشروع" });
  }
}));

api.get("/repository/versions", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { ownerId, repositoryId } = identity(req);
  const versions = await listVersions(ownerId, repositoryId);
  res.json({ versions: versions.map(version => ({
    id: version.id,
    versionNumber: version.versionNumber,
    archiveName: version.archiveName,
    sizeBytes: version.sizeBytes,
    actorType: version.actorType,
    actorName: version.actorName,
    createdAt: version.createdAt,
  })) });
}));

api.post("/repository/versions/:versionId/restore", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { ownerId, label, repositoryId } = identity(req);
  try {
    res.json({ version: await restoreVersion(ownerId, repositoryId, req.params.versionId, label, "agent") });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "تعذر استعادة النسخة" });
  }
}));

api.get("/repository/tasks", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { ownerId, repositoryId } = identity(req);
  res.json({ tasks: await listTasks(ownerId, repositoryId) });
}));

api.post("/repository/tasks", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { label, repositoryId } = identity(req);
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : null;
  if (!title || title.length > 180) {
    res.status(400).json({ error: "عنوان المهمة مطلوب وبحد أقصى 180 حرفًا" });
    return;
  }
  if (description && description.length > 4000) {
    res.status(400).json({ error: "وصف المهمة يتجاوز 4000 حرف" });
    return;
  }
  res.status(201).json({ task: await createTask(repositoryId, title, description, label, "agent") });
}));

api.patch("/repository/tasks/:taskId", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { label, repositoryId } = identity(req);
  const status = req.body?.status;
  const assignedAgent = req.body?.assignedAgent;
  if (status !== undefined && !["open", "in_progress", "done"].includes(status)) {
    res.status(400).json({ error: "حالة المهمة غير صالحة" });
    return;
  }
  if (assignedAgent !== undefined && assignedAgent !== null && (typeof assignedAgent !== "string" || assignedAgent.length > 80)) {
    res.status(400).json({ error: "اسم الوكيل غير صالح" });
    return;
  }
  if (status === undefined && assignedAgent === undefined) {
    res.status(400).json({ error: "أرسل الحالة أو الوكيل المكلّف للتحديث" });
    return;
  }
  try {
    res.json({ task: await updateTask(repositoryId, req.params.taskId, { status, assignedAgent }, label, "agent") });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "المهمة غير موجودة" });
  }
}));

api.get("/repository/activities", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { ownerId, repositoryId } = identity(req);
  res.json({ activities: await listActivities(ownerId, repositoryId) });
}));

api.post("/repository/messages", asyncRoute(async (req, res) => {
  const repository = await requireRepository(req, res);
  if (!repository) return;
  const { label, repositoryId } = identity(req);
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const taskId = typeof req.body?.taskId === "string" ? req.body.taskId : undefined;
  if (!message || message.length > 4000) {
    res.status(400).json({ error: "الرسالة مطلوبة وبحد أقصى 4000 حرف" });
    return;
  }
  if (req.body?.taskId !== undefined && typeof req.body.taskId !== "string") {
    res.status(400).json({ error: "معرّف المهمة غير صالح" });
    return;
  }
  try {
    await addAgentMessage(repositoryId, taskId, label, message);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "تعذر إضافة الرسالة" });
  }
}));

export function registerRepositoryAgentApi(app: Express) {
  app.use("/api/repository-agent/v1", api);
}
