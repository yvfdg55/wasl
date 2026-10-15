import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { sdk } from "./_core/sdk";
import { MAX_ARCHIVE_BYTES, addAgentMessage, authenticateAgentToken, createRepository, createTask, getArchiveDownload, getOwnedRepository, listActivities, listAgentKeys, listRepositories, listTasks, listVersions, restoreVersion, saveArchive, softDeleteRepository, updateTask, updateRepository } from "./workspace";

const api = express.Router();
type AgentRequest = Request & { agentOwnerId?: number; agentLabel?: string };
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };

api.use(express.json({ limit: "1mb" }));
api.use(asyncRoute(async (req, res, next) => {
  const authorization = req.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const key = token ? await authenticateAgentToken(token) : null;
  if (!key) {
    res.status(401).json({ error: "مفتاح API غير صالح أو ملغى" });
    return;
  }
  if (key.scope !== "full") {
    const endpoint = key.scope === "github_upload" ? "/api/github-upload/v1" : key.scope === "repository_edit" ? "/api/repository-agent/v1" : "/api/repository-upload/v1";
    res.status(403).json({ error: `هذا المفتاح محدود؛ استخدم ${endpoint}`, code: "wrong_key_scope" });
    return;
  }
  (req as AgentRequest).agentOwnerId = key.ownerId;
  (req as AgentRequest).agentLabel = key.label;
  next();
}));

function agent(req: Request) {
  const r = req as AgentRequest;
  return { ownerId: r.agentOwnerId!, label: r.agentLabel! };
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ الطلب";
}
async function requireRepo(ownerId: number, repositoryId: string, res: Response, includeArchived = false) {
  const repo = await getOwnedRepository(ownerId, repositoryId, includeArchived);
  if (!repo) res.status(404).json({ error: "المستودع غير موجود ضمن حساب هذا المفتاح" });
  return repo;
}

api.get("/repositories", asyncRoute(async (req, res) => {
  const { ownerId } = agent(req);
  res.json({ repositories: await listRepositories(ownerId) });
}));

api.post("/repositories", asyncRoute(async (req, res) => {
  const { ownerId, label } = agent(req);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : null;
  if (!name || name.length > 120) { res.status(400).json({ error: "اسم المستودع مطلوب وبحد أقصى 120 حرفًا" }); return; }
  try {
    const repository = await createRepository(ownerId, name, description, "agent", label);
    res.status(201).json({ repository });
  } catch (error) { res.status(409).json({ error: errorMessage(error) }); }
}));

api.get("/repositories/:repositoryId", asyncRoute(async (req, res) => {
  const { ownerId } = agent(req);
  const repository = await requireRepo(ownerId, req.params.repositoryId, res, true);
  if (!repository) return;
  const [versions, tasks, activities] = await Promise.all([
    listVersions(ownerId, repository.id), listTasks(ownerId, repository.id), listActivities(ownerId, repository.id),
  ]);
  res.json({ repository, versions, tasks, activities });
}));

api.patch("/repositories/:repositoryId", asyncRoute(async (req, res) => {
  const { ownerId, label } = agent(req);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
  const description = typeof req.body?.description === "string" ? req.body.description : undefined;
  if (name !== undefined && (!name || name.length > 120)) { res.status(400).json({ error: "اسم المستودع غير صالح" }); return; }
  try { res.json({ repository: await updateRepository(ownerId, req.params.repositoryId, { name, description }, "agent", label) }); }
  catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

api.delete("/repositories/:repositoryId", asyncRoute(async (req, res) => {
  const { ownerId } = agent(req);
  try { res.json(await softDeleteRepository(ownerId, req.params.repositoryId)); }
  catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

api.get("/repositories/:repositoryId/archive", asyncRoute(async (req, res) => {
  const { ownerId } = agent(req);
  try {
    const archive = await getArchiveDownload(ownerId, req.params.repositoryId);
    res.json({ archiveName: archive.archiveName, sizeBytes: archive.sizeBytes, versionNumber: archive.versionNumber, downloadUrl: archive.url });
  } catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

const zipBody = express.raw({ type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"], limit: MAX_ARCHIVE_BYTES });
api.post("/repositories/:repositoryId/archive", zipBody, asyncRoute(async (req, res) => {
  const { ownerId, label } = agent(req);
  const repository = await requireRepo(ownerId, req.params.repositoryId, res);
  if (!repository) return;
  if (!Buffer.isBuffer(req.body)) { res.status(415).json({ error: "أرسل الأرشيف بصيغة application/zip" }); return; }
  let archiveName = req.header("x-archive-name") || `${repository.name}.zip`;
  try { archiveName = decodeURIComponent(archiveName); } catch { /* keep the supplied name */ }
  try {
    const version = await saveArchive({ ownerId, repositoryId: repository.id, data: req.body, archiveName, actorType: "agent", actorName: label });
    res.status(201).json({ success: true, version });
  } catch (error) { res.status(400).json({ error: errorMessage(error) }); }
}));

api.get("/repositories/:repositoryId/versions", asyncRoute(async (req, res) => {
  const { ownerId } = agent(req);
  try { res.json({ versions: await listVersions(ownerId, req.params.repositoryId) }); }
  catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

api.post("/repositories/:repositoryId/versions/:versionId/restore", asyncRoute(async (req, res) => {
  const { ownerId, label } = agent(req);
  try { res.json({ version: await restoreVersion(ownerId, req.params.repositoryId, req.params.versionId, label, "agent") }); }
  catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

api.get("/repositories/:repositoryId/tasks", asyncRoute(async (req, res) => {
  const { ownerId } = agent(req);
  try { res.json({ tasks: await listTasks(ownerId, req.params.repositoryId) }); }
  catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

api.post("/repositories/:repositoryId/tasks", asyncRoute(async (req, res) => {
  const { ownerId, label } = agent(req);
  const repository = await requireRepo(ownerId, req.params.repositoryId, res);
  if (!repository) return;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : null;
  if (!title || title.length > 180) { res.status(400).json({ error: "عنوان المهمة مطلوب وبحد أقصى 180 حرفًا" }); return; }
  res.status(201).json({ task: await createTask(repository.id, title, description, label, "agent") });
}));

api.patch("/repositories/:repositoryId/tasks/:taskId", asyncRoute(async (req, res) => {
  const { ownerId, label } = agent(req);
  const repository = await requireRepo(ownerId, req.params.repositoryId, res, true);
  if (!repository) return;
  const status = req.body?.status;
  const assignedAgent = req.body?.assignedAgent;
  if (status !== undefined && !["open", "in_progress", "done"].includes(status)) { res.status(400).json({ error: "حالة المهمة غير صالحة" }); return; }
  if (assignedAgent !== undefined && assignedAgent !== null && (typeof assignedAgent !== "string" || assignedAgent.length > 80)) { res.status(400).json({ error: "اسم الوكيل غير صالح" }); return; }
  try { res.json({ task: await updateTask(repository.id, req.params.taskId, { status, assignedAgent }, label, "agent") }); }
  catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

api.get("/repositories/:repositoryId/activities", asyncRoute(async (req, res) => {
  const { ownerId } = agent(req);
  try { res.json({ activities: await listActivities(ownerId, req.params.repositoryId) }); }
  catch (error) { res.status(404).json({ error: errorMessage(error) }); }
}));

api.post("/repositories/:repositoryId/messages", asyncRoute(async (req, res) => {
  const { ownerId, label } = agent(req);
  const repository = await requireRepo(ownerId, req.params.repositoryId, res, true);
  if (!repository) return;
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const taskId = typeof req.body?.taskId === "string" ? req.body.taskId : undefined;
  if (!message || message.length > 4000) { res.status(400).json({ error: "الرسالة مطلوبة وبحد أقصى 4000 حرف" }); return; }
  try { await addAgentMessage(repository.id, taskId, label, message); res.status(201).json({ success: true }); }
  catch (error) { res.status(400).json({ error: errorMessage(error) }); }
}));

export function registerAgentApi(app: Express) {
  app.use("/api/agents/v1", api);
  app.post("/api/repositories/:repositoryId/archive", express.raw({ type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"], limit: MAX_ARCHIVE_BYTES }), asyncRoute(async (req, res) => {
    let user;
    try { user = await sdk.authenticateRequest(req); } catch { res.status(401).json({ error: "سجّل الدخول أولًا" }); return; }
    if (!user || user.id < 1) { res.status(401).json({ error: "سجّل الدخول أولًا" }); return; }
    const repository = await getOwnedRepository(user.id, req.params.repositoryId);
    if (!repository) { res.status(404).json({ error: "المستودع غير موجود" }); return; }
    if (!Buffer.isBuffer(req.body)) { res.status(415).json({ error: "أرسل الأرشيف بصيغة ZIP" }); return; }
    let archiveName = req.header("x-archive-name") || `${repository.name}.zip`;
    try { archiveName = decodeURIComponent(archiveName); } catch { /* keep the supplied name */ }
    try {
      const version = await saveArchive({ ownerId: user.id, repositoryId: repository.id, data: req.body, archiveName, actorType: "user", actorName: user.name || "صاحب المشروع" });
      res.status(201).json({ success: true, version });
    } catch (error) { res.status(400).json({ error: errorMessage(error) }); }
  }));
}
