ALTER TABLE "plugins" ADD COLUMN "logo_storage_key" text;
ALTER TABLE "plugins" ADD COLUMN "logo_content_type" text;
ALTER TABLE "plugin_versions" ADD COLUMN "bundle_storage_key" text;
ALTER TABLE "plugin_versions" ADD COLUMN "bundle_archive_storage_key" text;
