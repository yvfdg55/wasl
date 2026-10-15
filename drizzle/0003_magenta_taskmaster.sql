ALTER TABLE `agent_api_keys` MODIFY COLUMN `scope` enum('full','github_upload','repository_edit') NOT NULL DEFAULT 'full';--> statement-breakpoint
ALTER TABLE `agent_api_keys` ADD `scopedRepositoryId` varchar(36);--> statement-breakpoint
ALTER TABLE `agent_api_keys` ADD CONSTRAINT `agent_api_keys_scopedRepositoryId_repositories_id_fk` FOREIGN KEY (`scopedRepositoryId`) REFERENCES `repositories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `agent_api_keys_scoped_repository_idx` ON `agent_api_keys` (`scopedRepositoryId`);