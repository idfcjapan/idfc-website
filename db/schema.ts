import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

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
// Daily page-view totals only: no visitor, IP, cookie or user-agent records.
export const pageViewsDaily = sqliteTable('page_views_daily', {
  day: text('day').notNull(),
  path: text('path').notNull(),
  views: integer('views').notNull().default(0),
}, table => [primaryKey({ columns: [table.day, table.path] })]);
export const analyticsMetadata = sqliteTable('analytics_metadata', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});
