import { useLocation } from 'react-router-dom'
import { InvitationAcceptance } from '@/features/incidents/collaboration/InvitationAcceptance'
import { invitationFromHash } from '@/features/incidents/collaboration/invitation-types'

export default function InvitationPage() {
  const { hash } = useLocation()
  return <InvitationAcceptance token={invitationFromHash(hash)} />
}
