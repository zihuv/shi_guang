import { sql } from "drizzle-orm";
import {
  blob,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const folders = sqliteTable(
  "folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull().unique(),
    normalizedPath: text("normalized_path").notNull(),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
    createdAt: text("created_at").notNull(),
    isSystem: integer("is_system").default(0),
    sortOrder: integer("sort_order").default(0),
    deletedAt: text("deleted_at"),
    syncId: text("sync_id").notNull().unique(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_folders_parent_id").on(table.parentId),
    uniqueIndex("idx_folders_normalized_path").on(table.normalizedPath),
    index("idx_folders_parent_sort_order").on(table.parentId, table.sortOrder, table.name),
    index("idx_folders_deleted_at").on(table.deletedAt),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    path: text("path").notNull().unique(),
    normalizedPath: text("normalized_path").notNull(),
    name: text("name").notNull(),
    ext: text("ext").notNull(),
    size: integer("size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    folderId: integer("folder_id").references(() => folders.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    modifiedAt: text("modified_at").notNull(),
    importedAt: text("imported_at").notNull(),
    lastAccessedAt: text("last_accessed_at"),
    rating: integer("rating").notNull().default(0),
    description: text("description").notNull().default(""),
    sourceUrl: text("source_url").notNull().default(""),
    dominantColor: text("dominant_color").notNull().default(""),
    dominantR: integer("dominant_r"),
    dominantG: integer("dominant_g"),
    dominantB: integer("dominant_b"),
    colorDistribution: text("color_distribution").notNull().default("[]"),
    thumbHash: text("thumb_hash").notNull().default(""),
    deletedAt: text("deleted_at"),
    missingAt: text("missing_at"),
    syncId: text("sync_id").notNull().unique(),
    contentHash: text("content_hash"),
    fsModifiedAt: text("fs_modified_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_files_name").on(table.name),
    index("idx_files_ext").on(table.ext),
    uniqueIndex("idx_files_normalized_path").on(table.normalizedPath),
    index("idx_files_folder_id").on(table.folderId),
    index("idx_files_active_order").on(
      table.deletedAt,
      table.missingAt,
      sql`${table.importedAt} DESC`,
      table.id,
    ),
    index("idx_files_folder_active_order").on(
      table.folderId,
      table.deletedAt,
      table.missingAt,
      sql`${table.importedAt} DESC`,
      table.id,
    ),
    index("idx_files_active_imported")
      .on(sql`${table.importedAt} DESC`, table.id)
      .where(sql`${table.deletedAt} IS NULL AND ${table.missingAt} IS NULL`),
    index("idx_files_active_modified")
      .on(sql`${table.modifiedAt} DESC`, sql`${table.importedAt} DESC`, table.id)
      .where(sql`${table.deletedAt} IS NULL AND ${table.missingAt} IS NULL`),
    index("idx_files_active_created")
      .on(sql`${table.createdAt} DESC`, sql`${table.importedAt} DESC`, table.id)
      .where(sql`${table.deletedAt} IS NULL AND ${table.missingAt} IS NULL`),
    index("idx_files_active_size")
      .on(sql`${table.size} DESC`, sql`${table.importedAt} DESC`, table.id)
      .where(sql`${table.deletedAt} IS NULL AND ${table.missingAt} IS NULL`),
    index("idx_files_active_last_accessed")
      .on(sql`${table.lastAccessedAt} DESC`, sql`${table.importedAt} DESC`, table.id)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.missingAt} IS NULL AND ${table.lastAccessedAt} IS NOT NULL`,
      ),
    index("idx_files_active_folder_imported")
      .on(table.folderId, sql`${table.importedAt} DESC`, table.id)
      .where(sql`${table.deletedAt} IS NULL AND ${table.missingAt} IS NULL`),
    index("idx_files_dominant_rgb").on(table.dominantR, table.dominantG, table.dominantB),
    index("idx_files_deleted_at").on(table.deletedAt),
    index("idx_files_missing_at").on(table.missingAt),
    index("idx_files_last_accessed_at").on(table.lastAccessedAt),
    index("idx_files_content_hash").on(table.contentHash),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    parentId: integer("parent_id"),
    sortOrder: integer("sort_order").default(0),
    syncId: text("sync_id").notNull().unique(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_tags_parent_id").on(table.parentId),
    index("idx_tags_parent_sort_order").on(table.parentId, table.sortOrder, table.name),
    uniqueIndex("idx_tags_root_name_unique")
      .on(table.name)
      .where(sql`${table.parentId} IS NULL`),
    uniqueIndex("idx_tags_child_name_unique")
      .on(table.parentId, table.name)
      .where(sql`${table.parentId} IS NOT NULL`),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
  ],
);

export const fileTags = sqliteTable(
  "file_tags",
  {
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.fileId, table.tagId] }),
    index("idx_file_tags_tag_id_file_id").on(table.tagId, table.fileId),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const indexPaths = sqliteTable("index_paths", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
});

export const folderTrashEntries = sqliteTable(
  "folder_trash_entries",
  {
    folderId: integer("folder_id")
      .primaryKey()
      .references(() => folders.id, { onDelete: "cascade" }),
    tempPath: text("temp_path").notNull(),
    deletedAt: text("deleted_at").notNull(),
    fileCount: integer("file_count").notNull().default(0),
    subfolderCount: integer("subfolder_count").notNull().default(0),
  },
  (table) => [index("idx_folder_trash_entries_deleted_at").on(table.deletedAt)],
);

export const fileVisualEmbeddings = sqliteTable(
  "file_visual_embeddings",
  {
    fileId: integer("file_id")
      .primaryKey()
      .references(() => files.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: blob("embedding", { mode: "buffer" }),
    sourceSize: integer("source_size").notNull(),
    sourceModifiedAt: text("source_modified_at").notNull(),
    sourceContentHash: text("source_content_hash"),
    indexedAt: text("indexed_at").notNull(),
    status: text("status").notNull().default("pending"),
    lastError: text("last_error").notNull().default(""),
  },
  (table) => [index("idx_file_visual_embeddings_model_status").on(table.modelId, table.status)],
);

export const schema = {
  folders,
  files,
  tags,
  fileTags,
  settings,
  indexPaths,
  folderTrashEntries,
  fileVisualEmbeddings,
};
