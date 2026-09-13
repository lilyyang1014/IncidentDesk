import { useEffect } from 'react'
import { useAuth } from 'deepspace'
import { useLocation, useNavigate } from 'react-router-dom'
import { forgetInvitation, recalledInvitation } from './invitation-resume'

export function InvitationResume() {
  const { isSignedIn } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isSignedIn || location.pathname !== '/home') return
    const token = recalledInvitation()
    if (token) { forgetInvitation(); navigate(`/invite#token=${token}`, { replace: true }) }
  }, [isSignedIn, location.pathname, navigate])
  return null
}
