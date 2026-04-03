import { defineAuditTable, column } from 'oakbun'

export const auditLogs = defineAuditTable('audit_logs', {
  requestId: column.text().nullable(),
}).build()
