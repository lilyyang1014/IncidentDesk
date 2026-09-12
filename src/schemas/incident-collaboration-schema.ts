import type { CollectionSchema, ColumnDefinition } from 'deepspace/schema'

// SDK 0.33.1 computed columns are evaluated on every read, including RBAC and
// broadcasts. Membership is authoritative in one table, not copied to each note.
// Explicit physical IDs keep these expressions stable across display renames.
const text = (name: string): ColumnDefinition => ({ name, id: `col_${name.toLowerCase()}`, storage: 'text', interpretation: 'plain', required: true, immutable: true })
export const incidentCollaborators: ColumnDefinition = {
  name: 'collaborators', storage: 'text', interpretation: { kind: 'json' },
  expression: `SELECT COALESCE(json_group_array(m.col_userid), '[]') FROM c_incident_members m
    WHERE m.col_incidentid = c_incidents._row_id AND m.col_incidentcreatedat = c_incidents._created_at
      AND m.col_incidentowner = c_incidents._created_by`,
}
const noWrites = { create: false, update: false, delete: false } as const
export const incidentMembersSchema: CollectionSchema = {
  name: 'incident_members',
  columns: [text('incidentId'), text('incidentCreatedAt'), text('incidentOwner'), text('userId')],
  uniqueOn: ['incidentId', 'incidentCreatedAt', 'incidentOwner', 'userId'],
  // Internal membership rows are never editable/readable via generic clients.
  permissions: { '*': { read: false, ...noWrites }, member: { read: false, ...noWrites }, viewer: { read: false, ...noWrites }, admin: { read: false, ...noWrites } },
}
export const incidentNotesSchema: CollectionSchema = {
  name: 'incident_notes',
  columns: [text('incidentId'), text('incidentCreatedAt'), text('incidentOwner'), text('body'),
    { name: 'sequence', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    // A removed author must not retain access through the SDK's createdBy rule.
    { name: 'accessOwner', storage: 'text', interpretation: 'plain', expression: `SELECT i._created_by FROM c_incidents i
      WHERE i._row_id = c_incident_notes.col_incidentid AND i._created_at = c_incident_notes.col_incidentcreatedat
        AND i._created_by = c_incident_notes.col_incidentowner` },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' }, expression: `SELECT COALESCE(json_group_array(m.col_userid), '[]')
      FROM c_incident_members m JOIN c_incidents i ON i._row_id = m.col_incidentid AND i._created_at = m.col_incidentcreatedat AND i._created_by = m.col_incidentowner
      WHERE m.col_incidentid = c_incident_notes.col_incidentid AND m.col_incidentcreatedat = c_incident_notes.col_incidentcreatedat
        AND m.col_incidentowner = c_incident_notes.col_incidentowner` },
  ],
  ownerField: 'accessOwner', collaboratorsField: 'collaborators',
  uniqueOn: ['incidentId', 'incidentCreatedAt', 'incidentOwner', 'sequence'],
  permissions: { '*': { read: false, ...noWrites }, viewer: { read: 'collaborator', ...noWrites }, member: { read: 'collaborator', ...noWrites }, admin: { read: true, ...noWrites } },
}
