import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const repositories = mysqlTable("repositories", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: int("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  currentVersionId: varchar("currentVersionId", { length: 36 }),
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ ownerName: uniqueIndex("repositories_owner_name_unique").on(table.ownerId, table.name) }));

export const agentApiKeys = mysqlTable("agent_api_keys", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: int("ownerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 80 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  tokenPrefix: varchar("tokenPrefix", { length: 20 }).notNull(),
  scope: mysqlEnum("scope", ["full", "github_upload", "repository_edit", "repository_upload"]).default("full").notNull(),
  scopedRepositoryId: varchar("scopedRepositoryId", { length: 36 }).references(() => repositories.id, { onDelete: "cascade" }),
  revokedAt: timestamp("revokedAt"),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  owner: index("agent_api_keys_owner_idx").on(table.ownerId),
  scopedRepository: index("agent_api_keys_scoped_repository_idx").on(table.scopedRepositoryId),
}));

export const repositoryVersions = mysqlTable("repository_versions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  repositoryId: varchar("repositoryId", { length: 36 }).notNull().references(() => repositories.id, { onDelete: "cascade" }),
  versionNumber: int("versionNumber").notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  archiveName: varchar("archiveName", { length: 255 }).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  actorType: mysqlEnum("actorType", ["user", "agent", "restore"]).notNull(),
  actorName: varchar("actorName", { length: 120 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ repositoryVersion: uniqueIndex("repository_versions_number_unique").on(table.repositoryId, table.versionNumber) }));

export const projectTasks = mysqlTable("project_tasks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  repositoryId: varchar("repositoryId", { length: 36 }).notNull().references(() => repositories.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["open", "in_progress", "done"]).default("open").notNull(),
  assignedAgent: varchar("assignedAgent", { length: 80 }),
  createdBy: varchar("createdBy", { length: 120 }).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ repository: index("project_tasks_repository_idx").on(table.repositoryId) }));

export const projectActivities = mysqlTable("project_activities", {
  id: varchar("id", { length: 36 }).primaryKey(),
  repositoryId: varchar("repositoryId", { length: 36 }).notNull().references(() => repositories.id, { onDelete: "cascade" }),
  taskId: varchar("taskId", { length: 36 }),
  actorType: mysqlEnum("actorType", ["user", "agent", "system"]).notNull(),
  actorName: varchar("actorName", { length: 120 }).notNull(),
  kind: mysqlEnum("kind", ["created", "upload", "version", "task", "comment", "restore"]).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ repositoryDate: index("project_activities_repository_date_idx").on(table.repositoryId, table.createdAt) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Repository = typeof repositories.$inferSelect;
export type RepositoryVersion = typeof repositoryVersions.$inferSelect;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type ProjectActivity = typeof projectActivities.$inferSelect;
export type AgentApiKey = typeof agentApiKeys.$inferSelect;
