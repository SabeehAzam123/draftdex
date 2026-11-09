CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`week` integer NOT NULL,
	`home_entry_id` text NOT NULL,
	`away_entry_id` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`home_wins` integer,
	`away_wins` integer,
	`replay_url` text,
	`reported_by_entry_id` text,
	`reported_at` text,
	`dispute_reason` text,
	`decided_at` text,
	`resolved_by` text,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matches_league_idx` ON `matches` (`league_id`,`week`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`from_entry_id` text NOT NULL,
	`to_entry_id` text NOT NULL,
	`give` text NOT NULL,
	`get` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trades_league_idx` ON `trades` (`league_id`);--> statement-breakpoint
ALTER TABLE `picks` ADD `owner_entry_id` text REFERENCES entries(id);