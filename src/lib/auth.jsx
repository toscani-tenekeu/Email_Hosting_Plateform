import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { callApi } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  async function refreshAuth() {
    try {
      const result = await callApi('auth_me')
      setUser(result.user || null)
      return result.user || null
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refreshAuth() }, [])

  const value = useMemo(() => ({
    configured: true,
    session: user ? { user } : null,
    user,
    profile: user,
    loading,
    isAdmin: user?.role === 'admin',
    refreshProfile: refreshAuth,
    refreshAuth,
    async signOut() {
      await callApi('auth_logout').catch(() => undefined)
      setUser(null)
    },
  }), [user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
