import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { addActivity, createAgentKey, createRepository, createTask, getArchiveDownload, getOwnedRepository, listActivities, listAgentKeys, listRepositories, listTasks, listVersions, restoreVersion, revokeAgentKey, softDeleteRepository, updateRepository, updateTask } from "./workspace";
import { TRPCError } from "@trpc/server";

const repoId = z.string().uuid();
const status = z.enum(["open", "in_progress", "done"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  workspace: router({
    repositories: router({
      list: protectedProcedure.query(({ ctx }) => listRepositories(ctx.user.id)),
      detail: protectedProcedure.input(z.object({ id: repoId })).query(async ({ ctx, input }) => {
        const repository = await getOwnedRepository(ctx.user.id, input.id, true);
        if (!repository) throw new TRPCError({ code: "NOT_FOUND", message: "المستودع غير موجود" });
        return repository;
      }),
      create: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional().nullable() })).mutation(({ ctx, input }) =>
        createRepository(ctx.user.id, input.name, input.description ?? null, "user", ctx.user.name || "صاحب المشروع")),
      update: protectedProcedure.input(z.object({ id: repoId, name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).nullable().optional() })).mutation(({ ctx, input }) =>
        updateRepository(ctx.user.id, input.id, { name: input.name, description: input.description }, "user", ctx.user.name || "صاحب المشروع")),
      archive: protectedProcedure.input(z.object({ id: repoId })).mutation(({ ctx, input }) => softDeleteRepository(ctx.user.id, input.id)),
      versions: protectedProcedure.input(z.object({ id: repoId })).query(({ ctx, input }) => listVersions(ctx.user.id, input.id)),
      download: protectedProcedure.input(z.object({ id: repoId, versionId: repoId.optional() })).query(({ ctx, input }) => getArchiveDownload(ctx.user.id, input.id, input.versionId)),
      restore: protectedProcedure.input(z.object({ id: repoId, versionId: repoId })).mutation(({ ctx, input }) => restoreVersion(ctx.user.id, input.id, input.versionId, ctx.user.name || "صاحب المشروع")),
    }),
    tasks: router({
      list: protectedProcedure.input(z.object({ repositoryId: repoId })).query(({ ctx, input }) => listTasks(ctx.user.id, input.repositoryId)),
      create: protectedProcedure.input(z.object({ repositoryId: repoId, title: z.string().trim().min(1).max(180), description: z.string().max(4000).optional().nullable() })).mutation(async ({ ctx, input }) => {
        const repository = await getOwnedRepository(ctx.user.id, input.repositoryId, true);
        if (!repository) throw new TRPCError({ code: "NOT_FOUND", message: "المستودع غير موجود" });
        return createTask(repository.id, input.title, input.description ?? null, ctx.user.name || "صاحب المشروع");
      }),
      update: protectedProcedure.input(z.object({ repositoryId: repoId, taskId: repoId, status: status.optional(), assignedAgent: z.string().max(80).nullable().optional() })).mutation(async ({ ctx, input }) => {
        const repository = await getOwnedRepository(ctx.user.id, input.repositoryId, true);
        if (!repository) throw new TRPCError({ code: "NOT_FOUND", message: "المستودع غير موجود" });
        return updateTask(repository.id, input.taskId, { status: input.status, assignedAgent: input.assignedAgent }, ctx.user.name || "صاحب المشروع");
      }),
    }),
    activity: router({ list: protectedProcedure.input(z.object({ repositoryId: repoId.optional() }).optional()).query(({ ctx, input }) => listActivities(ctx.user.id, input?.repositoryId)) }),
    agents: router({
      listKeys: protectedProcedure.query(({ ctx }) => listAgentKeys(ctx.user.id)),
      createKey: protectedProcedure.input(z.object({ label: z.string().trim().min(1).max(80), scope: z.enum(["full", "github_upload"]).default("full") })).mutation(({ ctx, input }) => createAgentKey(ctx.user.id, input.label, input.scope)),
      revokeKey: protectedProcedure.input(z.object({ id: repoId })).mutation(({ ctx, input }) => revokeAgentKey(ctx.user.id, input.id)),
    }),
  }),
});

export type AppRouter = typeof appRouter;
