CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`is_secret` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`actor_name` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`detail_json` text,
	`ip` text,
	`user_agent` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE TABLE `changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diff_id` integer NOT NULL,
	`entity_type` text NOT NULL,
	`change_kind` text NOT NULL,
	`entity_key` text NOT NULL,
	`entity_name` text NOT NULL,
	`department_path_before` text,
	`department_path_after` text,
	`field` text,
	`before_json` text,
	`after_json` text,
	`severity` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`diff_id`) REFERENCES `diffs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_changes_diff` ON `changes` (`diff_id`,`entity_type`,`change_kind`);--> statement-breakpoint
CREATE INDEX `idx_changes_entity` ON `changes` (`diff_id`,`entity_key`);--> statement-breakpoint
CREATE TABLE `diffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer,
	`from_snapshot_id` integer,
	`to_snapshot_id` integer NOT NULL,
	`scope_root_department_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`total_changes` integer DEFAULT 0 NOT NULL,
	`people_added` integer DEFAULT 0 NOT NULL,
	`people_removed` integer DEFAULT 0 NOT NULL,
	`people_changed` integer DEFAULT 0 NOT NULL,
	`departments_added` integer DEFAULT 0 NOT NULL,
	`departments_removed` integer DEFAULT 0 NOT NULL,
	`departments_changed` integer DEFAULT 0 NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`ignored_reason` text,
	`resolved_by` integer,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_diffs_created` ON `diffs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_diffs_status` ON `diffs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_diffs_scope` ON `diffs` (`scope_root_department_id`,`to_snapshot_id`);--> statement-breakpoint
CREATE TABLE `inform_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inform_id` integer NOT NULL,
	`diff_id` integer NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`channel` text DEFAULT 'feishu_card' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message_id` text,
	`error_code` text,
	`error_message` text,
	`sent_at` text,
	`acknowledged_at` text,
	`acknowledged_by` integer,
	`acknowledged_via` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`inform_id`) REFERENCES `informs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_inform` ON `inform_deliveries` (`inform_id`);--> statement-breakpoint
CREATE INDEX `idx_deliveries_diff` ON `inform_deliveries` (`diff_id`,`recipient_type`,`recipient_id`);--> statement-breakpoint
CREATE TABLE `informs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diff_id` integer NOT NULL,
	`note` text,
	`change_ids_json` text,
	`created_by` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`diff_id`) REFERENCES `diffs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_informs_diff` ON `informs` (`diff_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`ip` text,
	`success` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_lookup` ON `login_attempts` (`username`,`ip`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`last_seen_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expiry` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `snapshot_departments` (
	`snapshot_id` integer NOT NULL,
	`open_department_id` text NOT NULL,
	`parent_open_department_id` text DEFAULT '0' NOT NULL,
	`name` text NOT NULL,
	`leader_open_id` text,
	`order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`path_names` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`snapshot_id`, `open_department_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_snapshot_departments_parent` ON `snapshot_departments` (`snapshot_id`,`parent_open_department_id`);--> statement-breakpoint
CREATE TABLE `snapshot_memberships` (
	`snapshot_id` integer NOT NULL,
	`open_id` text NOT NULL,
	`open_department_id` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `open_id`, `open_department_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memberships_department` ON `snapshot_memberships` (`snapshot_id`,`open_department_id`);--> statement-breakpoint
CREATE TABLE `snapshot_people` (
	`snapshot_id` integer NOT NULL,
	`open_id` text NOT NULL,
	`union_id` text,
	`user_id` text,
	`name` text NOT NULL,
	`email` text,
	`enterprise_email` text,
	`job_title` text,
	`employee_no` text,
	`status` text DEFAULT 'active' NOT NULL,
	`is_resigned` integer DEFAULT false NOT NULL,
	`is_frozen` integer DEFAULT false NOT NULL,
	`avatar_url` text,
	PRIMARY KEY(`snapshot_id`, `open_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_snapshot_people_email` ON `snapshot_people` (`snapshot_id`,`email`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope_root_department_id` text NOT NULL,
	`run_id` integer,
	`fetched_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`department_count` integer DEFAULT 0 NOT NULL,
	`people_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_scope` ON `snapshots` (`scope_root_department_id`,`status`,`id`);--> statement-breakpoint
CREATE TABLE `sync_run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`at` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`detail_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_run_events_run` ON `sync_run_events` (`run_id`,`at`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`phase` text DEFAULT 'token' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`department_count` integer DEFAULT 0 NOT NULL,
	`people_count` integer DEFAULT 0 NOT NULL,
	`added_people` integer DEFAULT 0 NOT NULL,
	`removed_people` integer DEFAULT 0 NOT NULL,
	`changed_people` integer DEFAULT 0 NOT NULL,
	`added_departments` integer DEFAULT 0 NOT NULL,
	`removed_departments` integer DEFAULT 0 NOT NULL,
	`changed_departments` integer DEFAULT 0 NOT NULL,
	`snapshot_id` integer,
	`diff_id` integer,
	`error_code` text,
	`error_message` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`requested_by` integer
);
--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `sync_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_task` ON `sync_runs` (`task_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`password_hash` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`feishu_open_id` text,
	`feishu_union_id` text,
	`feishu_user_id` text,
	`avatar_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_open_id` ON `users` (`feishu_open_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_union_id` ON `users` (`feishu_union_id`);--> statement-breakpoint
CREATE TABLE `watch_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cron` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`root_department_id` text DEFAULT '0' NOT NULL,
	`retention_runs` integer DEFAULT 60 NOT NULL,
	`created_by` integer,
	`last_run_at` text,
	`next_run_at` text,
	`locked_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_due` ON `watch_tasks` (`enabled`,`next_run_at`);