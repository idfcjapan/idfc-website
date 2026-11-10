CREATE TABLE legacy_page_views_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  views INTEGER NOT NULL,
  PRIMARY KEY (day, path)
);

CREATE VIEW combined_page_views_daily AS
  SELECT day, path, views FROM page_views_daily
  UNION ALL
  SELECT day, path, views FROM legacy_page_views_daily;
