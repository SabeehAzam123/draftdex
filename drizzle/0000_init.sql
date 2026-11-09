CREATE TABLE `draft_slots` (
	`league_id` text NOT NULL,
	`slot_no` integer NOT NULL,
	`entry_id` text NOT NULL,
	`round` integer NOT NULL,
	`kind` text DEFAULT 'regular' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`deadline` text,
	PRIMARY KEY(`league_id`, `slot_no`),
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_league_user_uq` ON `entries` (`league_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `entries_league_idx` ON `entries` (`league_id`);--> statement-breakpoint
CREATE TABLE `league_pool` (
	`league_id` text NOT NULL,
	`pokemon_id` integer NOT NULL,
	`points` integer NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`league_id`, `pokemon_id`),
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leagues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`status` text DEFAULT 'setup' NOT NULL,
	`commissioner_id` text NOT NULL,
	`settings` text NOT NULL,
	`webhook_url` text,
	`draft_order` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`commissioner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tx_id` text NOT NULL,
	`account` text NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`ref` text,
	`memo` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_account_idx` ON `ledger` (`account`);--> statement-breakpoint
CREATE INDEX `ledger_tx_idx` ON `ledger` (`tx_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`event` text NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_league_idx` ON `notifications` (`league_id`);--> statement-breakpoint
CREATE TABLE `picks` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`pokemon_id` integer NOT NULL,
	`points` integer NOT NULL,
	`slot_no` integer NOT NULL,
	`picked_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pokemon_id`) REFERENCES `pokemon`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `picks_league_pokemon_uq` ON `picks` (`league_id`,`pokemon_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `picks_league_slot_uq` ON `picks` (`league_id`,`slot_no`);--> statement-breakpoint
CREATE INDEX `picks_entry_idx` ON `picks` (`entry_id`);--> statement-breakpoint
CREATE TABLE `pokemon` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`types` text NOT NULL,
	`stats` text NOT NULL,
	`bst` integer NOT NULL,
	`generation` integer NOT NULL,
	`is_legendary` integer NOT NULL,
	`is_mythical` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pokemon_slug_unique` ON `pokemon` (`slug`);--> statement-breakpoint
CREATE INDEX `pokemon_name_idx` ON `pokemon` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`ui_variant` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);