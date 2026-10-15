import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { agentApiKeys, projectActivities, projectTasks, repositories, repositoryVersions } from "../drizzle/schema";
import { getDb } from "./db";
import { storageGetSignedUrl, storagePut } from "./storage";

export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
export type AgentKeyScope = "full" | "github_upload" | "repository_edit" | "repository_upload";
export const AGENT_TOKEN_PREFIX: Record<AgentKeyScope, string> = {
  full: "wasl_ak_",
  github_upload: "wasl_gh_",
  repository_edit: "wasl_re_",
  repository_upload: "wasl_up_",
};

function requireDb() {
  return getDb().then(db => {
    if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا");
    return db;
  });
}

export async function getOwnedRepository(ownerId: number, repositoryId: string, includeArchived = false) {
  const db = await requireDb();
  const where = includeArchived
    ? and(eq(repositories.ownerId, ownerId), eq(repositories.id, repositoryId))
    : and(eq(repositories.ownerId, ownerId), eq(repositories.id, repositoryId), isNull(repositories.archivedAt));
  const [repo] = await db.select().from(repositories).where(where).limit(1);
  return repo;
}

export async function listRepositories(ownerId: number) {
  const db = await requireDb();
  return db.select().from(repositories)
    .where(and(eq(repositories.ownerId, ownerId), isNull(repositories.archivedAt)))
    .orderBy(desc(repositories.updatedAt));
}

export async function createRepository(ownerId: number, name: string, description: string | null, actorType: "user" | "agent" = "user", actorName = "صاحب المشروع") {
  const db = await requireDb();
  const id = randomUUID();
  await db.insert(repositories).values({ id, ownerId, name: name.trim(), description: description?.trim() || null });
  await addActivity(id, actorType, actorName, "created", `أنشأ ${actorType === "agent" ? "الوكيل" : "المستخدم"} المستودع ${name.trim()}`);
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
  return repo;
}

/** Atomically creates and binds the first repository for a repository_upload key. */
export async function getOrCreateUploadKeyRepository(input: {
  apiKeyId: string; ownerId: number; name?: string; description?: string | null; actorName: string;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [key] = await tx.select().from(agentApiKeys)
      .where(and(eq(agentApiKeys.id, input.apiKeyId), eq(agentApiKeys.ownerId, input.ownerId), isNull(agentApiKeys.revokedAt)))
      .for("update").limit(1);
    if (!key || key.scope !== "repository_upload") throw new Error("مفتاح الرفع غير صالح أو ملغى");

    if (key.scopedRepositoryId) {
      const [repository] = await tx.select().from(repositories)
        .where(and(eq(repositories.id, key.scopedRepositoryId), eq(repositories.ownerId, input.ownerId))).limit(1);
      if (!repository) throw new Error("المستودع المرتبط بمفتاح الرفع غير موجود");
      return { repository, created: false };
    }

    const name = input.name?.trim();
    if (!name) throw new Error("اسم المستودع مطلوب عند أول رفع");
    const repositoryId = randomUUID();
    await tx.insert(repositories).values({
      id: repositoryId, ownerId: input.ownerId, name, description: input.description?.trim() || null,
    });
    await tx.update(agentApiKeys).set({ scopedRepositoryId: repositoryId }).where(eq(agentApiKeys.id, key.id));
    await tx.insert(projectActivities).values({
      id: randomUUID(), repositoryId, actorType: "agent", actorName: input.actorName.slice(0, 120), kind: "created",
      message: `أنشأ الوكيل المستودع ${name}`,
    });
    const [repository] = await tx.select().from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
    return { repository, created: true };
  });
}

export async function addActivity(repositoryId: string, actorType: "user" | "agent" | "system", actorName: string, kind: "created" | "upload" | "version" | "task" | "comment" | "restore", message: string, taskId?: string) {
  const db = await requireDb();
  await db.insert(projectActivities).values({ id: randomUUID(), repositoryId, taskId: taskId ?? null, actorType, actorName: actorName.slice(0, 120), kind, message: message.slice(0, 4000) });
  await db.update(repositories).set({ updatedAt: new Date() }).where(eq(repositories.id, repositoryId));
}

export async function saveArchive(input: {
  ownerId: number; repositoryId: string; data: Buffer; archiveName: string;
  actorType: "user" | "agent" | "restore"; actorName: string;
}) {
  const repo = await getOwnedRepository(input.ownerId, input.repositoryId);
  if (!repo) throw new Error("المستودع غير موجود أو لا تملك صلاحية الوصول إليه");
  if (!input.data.length || input.data.length > MAX_ARCHIVE_BYTES) throw new Error("حجم الملف يجب أن يكون بين 1 بايت و25 ميغابايت");
  if (!isValidZipStructure(input.data)) throw new Error("الأرشيف ZIP غير مكتمل أو غير صالح");
  const safeName = input.archiveName.replace(/[\\/\0-\x1f]/g, "_").slice(0, 255) || `${repo.name}.zip`;
  const { key } = await storagePut(`wasl/${input.ownerId}/repositories/${repo.id}/${randomUUID()}.zip`, input.data, "application/zip");
  const db = await requireDb();
  const versionId = randomUUID();
  const { versionNumber, isFirst } = await db.transaction(async tx => {
    const [lockedRepo] = await tx.select().from(repositories).where(eq(repositories.id, repo.id)).for("update").limit(1);
    if (!lockedRepo || lockedRepo.archivedAt) throw new Error("المستودع أُرشف قبل اكتمال الرفع");
    const [latest] = await tx.select().from(repositoryVersions)
      .where(eq(repositoryVersions.repositoryId, repo.id))
      .orderBy(desc(repositoryVersions.versionNumber)).limit(1);
    const nextVersion = (latest?.versionNumber ?? 0) + 1;
    await tx.insert(repositoryVersions).values({
      id: versionId, repositoryId: repo.id, versionNumber: nextVersion, storageKey: key, archiveName: safeName,
      sizeBytes: input.data.length, actorType: input.actorType, actorName: input.actorName.slice(0, 120),
    });
    await tx.update(repositories).set({ currentVersionId: versionId, updatedAt: new Date() }).where(eq(repositories.id, repo.id));
    return { versionNumber: nextVersion, isFirst: !latest };
  });
  await addActivity(repo.id, input.actorType === "restore" ? "user" : input.actorType, input.actorName,
    isFirst ? "upload" : "version", `${isFirst ? "رفع ملفات المشروع" : "رفع نسخة جديدة"} (${(input.data.length / 1024 / 1024).toFixed(1)} م.ب)`);
  return { versionId, versionNumber, archiveName: safeName, sizeBytes: input.data.length, createdAt: new Date() };
}

export async function listVersions(ownerId: number, repositoryId: string) {
  const repo = await getOwnedRepository(ownerId, repositoryId, true);
  if (!repo) throw new Error("المستودع غير موجود");
  const db = await requireDb();
  return db.select().from(repositoryVersions).where(eq(repositoryVersions.repositoryId, repositoryId)).orderBy(desc(repositoryVersions.versionNumber));
}

export async function getArchiveDownload(ownerId: number, repositoryId: string, versionId?: string) {
  const repo = await getOwnedRepository(ownerId, repositoryId, true);
  if (!repo) throw new Error("المستودع غير موجود");
  const db = await requireDb();
  const version = versionId
    ? (await db.select().from(repositoryVersions).where(and(eq(repositoryVersions.repositoryId, repositoryId), eq(repositoryVersions.id, versionId))).limit(1))[0]
    : (await db.select().from(repositoryVersions).where(eq(repositoryVersions.repositoryId, repositoryId)).orderBy(desc(repositoryVersions.versionNumber)).limit(1))[0];
  if (!version) throw new Error("لا توجد نسخة مرفوعة لهذا المستودع");
  return { ...version, url: await storageGetSignedUrl(version.storageKey) };
}

export async function restoreVersion(ownerId: number, repositoryId: string, versionId: string, actorName: string, actorType: "user" | "agent" = "user") {
  const repo = await getOwnedRepository(ownerId, repositoryId, true);
  if (!repo) throw new Error("المستودع غير موجود");
  const db = await requireDb();
  const id = randomUUID();
  const restored = await db.transaction(async tx => {
    const [lockedRepo] = await tx.select().from(repositories).where(eq(repositories.id, repositoryId)).for("update").limit(1);
    if (!lockedRepo || lockedRepo.ownerId !== ownerId) throw new Error("المستودع غير موجود");
    const [source] = await tx.select().from(repositoryVersions).where(and(eq(repositoryVersions.repositoryId, repositoryId), eq(repositoryVersions.id, versionId))).limit(1);
    if (!source) throw new Error("النسخة المطلوبة غير موجودة");
    const [latest] = await tx.select().from(repositoryVersions).where(eq(repositoryVersions.repositoryId, repositoryId)).orderBy(desc(repositoryVersions.versionNumber)).limit(1);
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    await tx.insert(repositoryVersions).values({
      id, repositoryId, versionNumber, storageKey: source.storageKey,
      archiveName: source.archiveName, sizeBytes: source.sizeBytes, actorType: "restore", actorName: actorName.slice(0, 120),
    });
    await tx.update(repositories).set({ currentVersionId: id, archivedAt: null, updatedAt: new Date() }).where(eq(repositories.id, repositoryId));
    return { sourceVersion: source.versionNumber, versionNumber };
  });
  await addActivity(repositoryId, actorType, actorName, "restore", `استعاد النسخة ${restored.sourceVersion}`);
  return { id, versionNumber: restored.versionNumber };
}

export async function softDeleteRepository(ownerId: number, repositoryId: string) {
  const repo = await getOwnedRepository(ownerId, repositoryId);
  if (!repo) throw new Error("المستودع غير موجود");
  const db = await requireDb();
  await db.update(repositories).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(repositories.id, repositoryId));
  return { success: true };
}

export async function listTasks(ownerId: number, repositoryId: string) {
  const repo = await getOwnedRepository(ownerId, repositoryId, true);
  if (!repo) throw new Error("المستودع غير موجود");
  const db = await requireDb();
  return db.select().from(projectTasks).where(eq(projectTasks.repositoryId, repositoryId)).orderBy(desc(projectTasks.updatedAt));
}

export async function createTask(repositoryId: string, title: string, description: string | null, actorName: string, actorType: "user" | "agent" = "user") {
  const db = await requireDb();
  const id = randomUUID();
  await db.insert(projectTasks).values({ id, repositoryId, title: title.trim(), description: description?.trim() || null, createdBy: actorName.slice(0, 120) });
  await addActivity(repositoryId, actorType, actorName, "task", `أُنشئت مهمة: ${title.trim()}`, id);
  return (await db.select().from(projectTasks).where(eq(projectTasks.id, id)).limit(1))[0];
}

export async function updateTask(repositoryId: string, taskId: string, input: { status?: "open" | "in_progress" | "done"; assignedAgent?: string | null }, actorName: string, actorType: "user" | "agent" = "user") {
  const db = await requireDb();
  const [task] = await db.select().from(projectTasks).where(and(eq(projectTasks.repositoryId, repositoryId), eq(projectTasks.id, taskId))).limit(1);
  if (!task) throw new Error("المهمة غير موجودة");
  await db.update(projectTasks).set({ ...input, updatedAt: new Date() }).where(eq(projectTasks.id, taskId));
  if (input.status && input.status !== task.status) await addActivity(repositoryId, actorType, actorName, "task", `حدّث ${actorName} حالة «${task.title}» إلى ${input.status === "done" ? "مكتملة" : input.status === "in_progress" ? "قيد التنفيذ" : "مفتوحة"}`, taskId);
  if (input.assignedAgent !== undefined && input.assignedAgent !== task.assignedAgent) await addActivity(repositoryId, actorType, actorName, "task", `تم تغيير الوكيل المكلّف بالمهمة «${task.title}»`, taskId);
  return (await db.select().from(projectTasks).where(eq(projectTasks.id, taskId)).limit(1))[0];
}

export async function listActivities(ownerId: number, repositoryId?: string) {
  const db = await requireDb();
  if (repositoryId) {
    const repo = await getOwnedRepository(ownerId, repositoryId, true);
    if (!repo) throw new Error("المستودع غير موجود");
    return db.select().from(projectActivities).where(eq(projectActivities.repositoryId, repositoryId)).orderBy(desc(projectActivities.createdAt)).limit(80);
  }
  const owned = await db.select({ id: repositories.id }).from(repositories).where(eq(repositories.ownerId, ownerId));
  if (!owned.length) return [];
  const all = await Promise.all(owned.map(repo => db.select().from(projectActivities).where(eq(projectActivities.repositoryId, repo.id)).orderBy(desc(projectActivities.createdAt)).limit(30)));
  return all.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 80);
}

export async function addAgentMessage(repositoryId: string, taskId: string | undefined, agentName: string, message: string) {
  if (taskId) {
    const db = await requireDb();
    const [task] = await db.select().from(projectTasks).where(and(eq(projectTasks.id, taskId), eq(projectTasks.repositoryId, repositoryId))).limit(1);
    if (!task) throw new Error("المهمة غير موجودة في هذا المستودع");
  }
  await addActivity(repositoryId, "agent", agentName, "comment", message, taskId);
  return { success: true };
}

export async function listAgentKeys(ownerId: number) {
  const db = await requireDb();
  return db.select({ id: agentApiKeys.id, label: agentApiKeys.label, scope: agentApiKeys.scope, scopedRepositoryId: agentApiKeys.scopedRepositoryId, scopedRepositoryName: repositories.name, scopedRepositoryArchivedAt: repositories.archivedAt, tokenPrefix: agentApiKeys.tokenPrefix, revokedAt: agentApiKeys.revokedAt, lastUsedAt: agentApiKeys.lastUsedAt, createdAt: agentApiKeys.createdAt })
    .from(agentApiKeys).leftJoin(repositories, eq(agentApiKeys.scopedRepositoryId, repositories.id)).where(eq(agentApiKeys.ownerId, ownerId)).orderBy(desc(agentApiKeys.createdAt));
}

export async function createAgentKey(ownerId: number, label: string, scope: AgentKeyScope = "full", scopedRepositoryId?: string) {
  const db = await requireDb();
  if (scope === "repository_edit" && !scopedRepositoryId) throw new Error("اختر المستودع الذي سيقتصر عليه المفتاح");
  if (scope !== "repository_edit" && scopedRepositoryId) throw new Error("لا يمكن ربط هذا النوع من المفاتيح بمستودع واحد");
  const scopedRepository = scope === "repository_edit" ? await getOwnedRepository(ownerId, scopedRepositoryId!) : undefined;
  if (scope === "repository_edit" && !scopedRepository) throw new Error("المستودع غير موجود أو لا تملك صلاحية الوصول إليه");
  const token = `${AGENT_TOKEN_PREFIX[scope]}${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  await db.insert(agentApiKeys).values({
    id, ownerId, label: label.trim().slice(0, 80), tokenHash: createHash("sha256").update(token).digest("hex"),
    tokenPrefix: token.slice(0, 16), scope, scopedRepositoryId: scopedRepository?.id ?? null,
  });
  return { id, label: label.trim(), scope, scopedRepositoryId: scopedRepository?.id ?? null, repositoryName: scopedRepository?.name ?? null, token };
}

export async function revokeAgentKey(ownerId: number, keyId: string) {
  const db = await requireDb();
  await db.update(agentApiKeys).set({ revokedAt: new Date() }).where(and(eq(agentApiKeys.id, keyId), eq(agentApiKeys.ownerId, ownerId), isNull(agentApiKeys.revokedAt)));
  return { success: true };
}

export async function authenticateAgentToken(token: string) {
  if (token.length > 100 || !/^wasl_(?:ak|gh|re|up)_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = await requireDb();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [key] = await db.select().from(agentApiKeys).where(and(eq(agentApiKeys.tokenHash, tokenHash), isNull(agentApiKeys.revokedAt))).limit(1);
  if (!key) return null;
  if (key.scope === "repository_edit" && !key.scopedRepositoryId) return null;
  if ((key.scope === "full" || key.scope === "github_upload") && key.scopedRepositoryId !== null) return null;
  await db.update(agentApiKeys).set({ lastUsedAt: new Date() }).where(eq(agentApiKeys.id, key.id));
  return key;
}

export async function updateRepository(ownerId: number, repositoryId: string, input: { name?: string; description?: string | null }, actorType: "user" | "agent" = "user", actorName = "صاحب المشروع") {
  const repo = await getOwnedRepository(ownerId, repositoryId);
  if (!repo) throw new Error("المستودع غير موجود أو مؤرشف");
  const db = await requireDb();
  const patch: { name?: string; description?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  await db.update(repositories).set(patch).where(eq(repositories.id, repositoryId));
  await addActivity(repositoryId, actorType, actorName, "version", `تم تحديث بيانات المستودع بواسطة ${actorName}`);
  return (await db.select().from(repositories).where(eq(repositories.id, repositoryId)).limit(1))[0];
}

export function isValidZipStructure(data: Buffer) {
  if (data.length < 22) return false;
  const searchStart = Math.max(0, data.length - 22 - 0xffff);
  let endRecord = -1;
  for (let offset = data.length - 22; offset >= searchStart; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50 && offset + 22 + data.readUInt16LE(offset + 20) === data.length) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) return false;
  const diskNumber = data.readUInt16LE(endRecord + 4);
  const directoryDisk = data.readUInt16LE(endRecord + 6);
  const diskEntries = data.readUInt16LE(endRecord + 8);
  const totalEntries = data.readUInt16LE(endRecord + 10);
  const directorySize = data.readUInt32LE(endRecord + 12);
  const directoryOffset = data.readUInt32LE(endRecord + 16);
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries || totalEntries > 20000) return false;
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd > endRecord || directoryOffset > data.length) return false;
  if (totalEntries === 0) return directorySize === 0;

  let cursor = directoryOffset;
  for (let entry = 0; entry < totalEntries; entry += 1) {
    if (cursor + 46 > directoryEnd || data.readUInt32LE(cursor) !== 0x02014b50) return false;
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd || compressedSize === 0xffffffff || localOffset + 30 > directoryOffset) return false;
    if (data.readUInt32LE(localOffset) !== 0x04034b50) return false;
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const contentStart = localOffset + 30 + localNameLength + localExtraLength;
    if (contentStart > directoryOffset || compressedSize > directoryOffset - contentStart) return false;
    cursor = next;
  }
  return cursor <= directoryEnd;
}
