CREATE TABLE `edit_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`csrf` text NOT NULL,
	`expires_at` integer NOT NULL,
	`password_tag` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `page_edits` (
	`path` text PRIMARY KEY NOT NULL,
	`html` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
