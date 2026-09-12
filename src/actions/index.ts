import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { saveIncident } from './write-incident'
import { analyzeIncident } from './analyze-incident'

import { findIncidentReferences } from './find-incident-references'

import { incidentEmail } from './incident-email'
import { incidentCollaboration } from './incident-collaboration'

export const actions: Record<string, ActionHandler<Env>> = { analyzeIncident, findIncidentReferences, incidentEmail, incidentCollaboration, saveIncident }
