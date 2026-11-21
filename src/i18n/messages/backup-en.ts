export const backup = {
  title: "Database backups",
  description: "Create an encrypted backup and review recent backup runs.",
  download: "Download backup",
  downloadHelp:
    "Keep this page open while Windows creates the backup. Store the downloaded file with your protected backup copies.",
  unconfigured: "The Windows backup configuration is missing or unavailable.",
  busy: "A backup is already running. Try again after it completes.",
  failed:
    "The backup download could not complete. Review the backup history and Windows backup logs.",
  last: "Last successful backup",
  none: "No successful backup has been recorded.",
  stale: "The last successful backup is more than 48 hours old.",
  history: "Recent backup runs",
  empty: "No backup runs recorded.",
  source: "Source",
  state: "Status",
  started: "Started",
  completed: "Completed",
  archive: "Archive and SHA-256",
  excluded:
    "Backups contain business records and staff directory entries. Staff credentials and sessions are recreated after a restore.",
  sources: { MANUAL: "Manual", SCHEDULED: "Scheduled" },
  states: { RUNNING: "Running", SUCCEEDED: "Succeeded", FAILED: "Failed" },
  view: "View backups",
  unavailable: "—",
} as const;
