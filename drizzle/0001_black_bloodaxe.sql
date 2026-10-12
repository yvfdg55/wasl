CREATE TABLE `agent_api_keys` (
	`id` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`tokenPrefix` varchar(20) NOT NULL,
	`revokedAt` timestamp,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_api_keys_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `project_activities` (
	`id` varchar(36) NOT NULL,
	`repositoryId` varchar(36) NOT NULL,
	`taskId` varchar(36),
	`actorType` enum('user','agent','system') NOT NULL,
	`actorName` varchar(120) NOT NULL,
	`kind` enum('created','upload','version','task','comment','restore') NOT NULL,
	`message` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`id` varchar(36) NOT NULL,
	`repositoryId` varchar(36) NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text,
	`status` enum('open','in_progress','done') NOT NULL DEFAULT 'open',
	`assignedAgent` varchar(80),
	`createdBy` varchar(120) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`currentVersionId` varchar(36),
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `repositories_id` PRIMARY KEY(`id`),
	CONSTRAINT `repositories_owner_name_unique` UNIQUE(`ownerId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `repository_versions` (
	`id` varchar(36) NOT NULL,
	`repositoryId` varchar(36) NOT NULL,
	`versionNumber` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`archiveName` varchar(255) NOT NULL,
	`sizeBytes` int NOT NULL,
	`actorType` enum('user','agent','restore') NOT NULL,
	`actorName` varchar(120) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repository_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `repository_versions_number_unique` UNIQUE(`repositoryId`,`versionNumber`)
);
--> statement-breakpoint
ALTER TABLE `agent_api_keys` ADD CONSTRAINT `agent_api_keys_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_activities` ADD CONSTRAINT `project_activities_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD CONSTRAINT `project_tasks_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repositories` ADD CONSTRAINT `repositories_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `repository_versions` ADD CONSTRAINT `repository_versions_repositoryId_repositories_id_fk` FOREIGN KEY (`repositoryId`) REFERENCES `repositories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `agent_api_keys_owner_idx` ON `agent_api_keys` (`ownerId`);--> statement-breakpoint
CREATE INDEX `project_activities_repository_date_idx` ON `project_activities` (`repositoryId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `project_tasks_repository_idx` ON `project_tasks` (`repositoryId`);