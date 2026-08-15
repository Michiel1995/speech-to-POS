export const LOCAL_STORAGE_KEYS = {
  activeTable: "service-ears:table",
  drafts: "service-ears:drafts-by-table",
  context: "service-ears:context-by-table",
  events: "service-ears:events-by-table:v2",
  languageLearning: "service-ears:language-learning:v2",
  backupRollback: "service-ears:backup-rollback:v1",
} as const;

export const BACKUP_CONTROLLED_STORAGE_KEYS = [
  LOCAL_STORAGE_KEYS.activeTable,
  LOCAL_STORAGE_KEYS.drafts,
  LOCAL_STORAGE_KEYS.context,
  LOCAL_STORAGE_KEYS.events,
  LOCAL_STORAGE_KEYS.languageLearning,
] as const;

export const BACKUP_RESTORE_NOTICE_KEY = "service-ears:backup-restore-notice:v1";
