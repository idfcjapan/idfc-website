import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const pageEdits = sqliteTable('page_edits', {
  path: text('path').primaryKey(),
  html: text('html').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: integer('updated_at').notNull(),
});
export const editSessions = sqliteTable('edit_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  csrf: text('csrf').notNull(),
  expiresAt: integer('expires_at').notNull(),
  passwordTag: text('password_tag').notNull(),
});
export const loginLimits = sqliteTable('login_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  resetAt: integer('reset_at').notNull(),
});
