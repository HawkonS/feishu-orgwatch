ALTER TABLE `snapshot_people` ADD `leader_open_id` text;--> statement-breakpoint
ALTER TABLE `snapshots` ADD `tracks_leader` integer DEFAULT false NOT NULL;