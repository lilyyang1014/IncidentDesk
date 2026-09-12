import { describe, expect, it } from 'vitest'
import { collaboratorIds, incidentCapabilities } from './incident-permissions'
const record = { createdBy: 'a', data: { collaborators: ['b'] } }
describe('incident capabilities', () => {
  it('grants invited users read/comment only', () => {
    expect(incidentCapabilities(record,'b','member')).toEqual({ read:true, comment:true, manageMembers:false, operate:false })
    expect(incidentCapabilities(record,'a','member')).toEqual({ read:true, comment:true, manageMembers:true, operate:true })
  })
  it('preserves admin operations but reserves member management for the creator', () => {
    expect(incidentCapabilities(record,'admin','admin')).toEqual({ read:true, comment:true, manageMembers:false, operate:true })
  })
  it('denies uninvited and removed callers', () => {
    expect(incidentCapabilities(record,'c','member').read).toBe(false)
    expect(incidentCapabilities({createdBy:'a',data:{}},'b','member').read).toBe(false)
  })
  it('accepts only explicit string ids and never treats malformed ACL as public', () => {
    expect(collaboratorIds('["b","b"]')).toEqual(['b'])
    expect(collaboratorIds('bad')).toEqual([])
    expect(collaboratorIds({b:true})).toEqual([])
    expect(collaboratorIds(['b',null,1])).toEqual(['b'])
  })
})
