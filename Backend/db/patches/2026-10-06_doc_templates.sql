-- Шаблоны документов (визуальный дизайнер на GrapesJS Studio SDK).
-- Хранится и проект Studio (для редактирования), и экспортированный Jinja (для рендера).
-- Те же таблицы создаёт lib/doc-templates/store.ts при первом обращении.
SET client_encoding TO 'UTF8';

CREATE TABLE IF NOT EXISTS wms_doc_templates (
  template_id BIGSERIAL PRIMARY KEY,
  site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  doc_kind TEXT NOT NULL DEFAULT 'trade',
  doc_type_label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ NULL,
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_doc_template_versions (
  version_id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES wms_doc_templates(template_id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  page_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  studio_project JSONB NULL,
  jinja_template TEXT NOT NULL DEFAULT '',
  data_schema_version INT NOT NULL DEFAULT 1,
  sample_id TEXT NULL,
  created_by TEXT NULL,
  updated_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NULL,
  UNIQUE (template_id, version_no)
);

-- Не больше одного черновика и одной опубликованной версии на шаблон.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_doc_template_versions_draft
  ON wms_doc_template_versions(template_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_doc_template_versions_published
  ON wms_doc_template_versions(template_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS ix_wms_doc_templates_site
  ON wms_doc_templates(site_id, updated_at DESC);
