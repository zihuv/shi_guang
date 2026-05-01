CREATE TABLE `file_tags` (
	`file_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`file_id`, `tag_id`),
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_file_tags_tag_id_file_id` ON `file_tags` (`tag_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `file_visual_embeddings` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`dimensions` integer NOT NULL,
	`embedding` blob,
	`source_size` integer NOT NULL,
	`source_modified_at` text NOT NULL,
	`source_content_hash` text,
	`indexed_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_file_visual_embeddings_model_status` ON `file_visual_embeddings` (`model_id`,`status`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`normalized_path` text NOT NULL,
	`name` text NOT NULL,
	`ext` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`folder_id` integer,
	`created_at` text NOT NULL,
	`modified_at` text NOT NULL,
	`imported_at` text NOT NULL,
	`last_accessed_at` text,
	`rating` integer DEFAULT 0 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`dominant_color` text DEFAULT '' NOT NULL,
	`dominant_r` integer,
	`dominant_g` integer,
	`dominant_b` integer,
	`color_distribution` text DEFAULT '[]' NOT NULL,
	`thumb_hash` text DEFAULT '' NOT NULL,
	`deleted_at` text,
	`missing_at` text,
	`sync_id` text NOT NULL,
	`content_hash` text,
	`fs_modified_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_path_unique` ON `files` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_sync_id_unique` ON `files` (`sync_id`);--> statement-breakpoint
CREATE INDEX `idx_files_name` ON `files` (`name`);--> statement-breakpoint
CREATE INDEX `idx_files_ext` ON `files` (`ext`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_files_normalized_path` ON `files` (`normalized_path`);--> statement-breakpoint
CREATE INDEX `idx_files_folder_id` ON `files` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_files_active_order` ON `files` (`deleted_at`,`missing_at`,"imported_at" DESC,`id`);--> statement-breakpoint
CREATE INDEX `idx_files_folder_active_order` ON `files` (`folder_id`,`deleted_at`,`missing_at`,"imported_at" DESC,`id`);--> statement-breakpoint
CREATE INDEX `idx_files_active_imported` ON `files` ("imported_at" DESC,`id`) WHERE "files"."deleted_at" IS NULL AND "files"."missing_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_files_active_modified` ON `files` ("modified_at" DESC,"imported_at" DESC,`id`) WHERE "files"."deleted_at" IS NULL AND "files"."missing_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_files_active_created` ON `files` ("created_at" DESC,"imported_at" DESC,`id`) WHERE "files"."deleted_at" IS NULL AND "files"."missing_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_files_active_size` ON `files` ("size" DESC,"imported_at" DESC,`id`) WHERE "files"."deleted_at" IS NULL AND "files"."missing_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_files_active_last_accessed` ON `files` ("last_accessed_at" DESC,"imported_at" DESC,`id`) WHERE "files"."deleted_at" IS NULL AND "files"."missing_at" IS NULL AND "files"."last_accessed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_files_active_folder_imported` ON `files` (`folder_id`,"imported_at" DESC,`id`) WHERE "files"."deleted_at" IS NULL AND "files"."missing_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_files_dominant_rgb` ON `files` (`dominant_r`,`dominant_g`,`dominant_b`);--> statement-breakpoint
CREATE INDEX `idx_files_deleted_at` ON `files` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_files_missing_at` ON `files` (`missing_at`);--> statement-breakpoint
CREATE INDEX `idx_files_last_accessed_at` ON `files` (`last_accessed_at`);--> statement-breakpoint
CREATE INDEX `idx_files_content_hash` ON `files` (`content_hash`);--> statement-breakpoint
CREATE TABLE `folder_trash_entries` (
	`folder_id` integer PRIMARY KEY NOT NULL,
	`temp_path` text NOT NULL,
	`deleted_at` text NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`subfolder_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_folder_trash_entries_deleted_at` ON `folder_trash_entries` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`normalized_path` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`created_at` text NOT NULL,
	`is_system` integer DEFAULT 0,
	`sort_order` integer DEFAULT 0,
	`deleted_at` text,
	`sync_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_path_unique` ON `folders` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `folders_sync_id_unique` ON `folders` (`sync_id`);--> statement-breakpoint
CREATE INDEX `idx_folders_parent_id` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_folders_normalized_path` ON `folders` (`normalized_path`);--> statement-breakpoint
CREATE INDEX `idx_folders_parent_sort_order` ON `folders` (`parent_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE INDEX `idx_folders_deleted_at` ON `folders` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `index_paths` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_paths_path_unique` ON `index_paths` (`path`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`parent_id` integer,
	`sort_order` integer DEFAULT 0,
	`sync_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_sync_id_unique` ON `tags` (`sync_id`);--> statement-breakpoint
CREATE INDEX `idx_tags_parent_id` ON `tags` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_tags_parent_sort_order` ON `tags` (`parent_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_root_name_unique` ON `tags` (`name`) WHERE "tags"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tags_child_name_unique` ON `tags` (`parent_id`,`name`) WHERE "tags"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `update_files_updated_at`
AFTER UPDATE ON `files`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE `files` SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;--> statement-breakpoint
CREATE TRIGGER `update_folders_updated_at`
AFTER UPDATE ON `folders`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE `folders` SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;--> statement-breakpoint
CREATE TRIGGER `update_tags_updated_at`
AFTER UPDATE ON `tags`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE `tags` SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;--> statement-breakpoint
CREATE TRIGGER `update_file_tags_file_updated_at_insert`
AFTER INSERT ON `file_tags`
FOR EACH ROW
BEGIN
	UPDATE `files` SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.file_id;
END;--> statement-breakpoint
CREATE TRIGGER `update_file_tags_file_updated_at_delete`
AFTER DELETE ON `file_tags`
FOR EACH ROW
BEGIN
	UPDATE `files` SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.file_id;
END;
