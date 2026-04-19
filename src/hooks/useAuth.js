import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  signInAnonymously
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useStore } from '../store'
import { savePlatform, PLATFORM_DOC } from '../lib/firestore'
import { getDoc } from 'firebase/firestore'

// ─── SHA-256 ──────────────────────────────────────────────
async function hashPassword(password) {
  if (!password) return null
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

// ─── Rate limiter ─────────────────────────────────────────
const _attempts = {}
function checkRateLimit(key) {
  const now = Date.now()
  _attempts[key] = (_attempts[key] || []).filter(t => now - t < 60_000)
  if (_attempts[key].length >= 5) return false
  _attempts[key].push(now)
  return true
}

function getLatestPlatform() {
  return useStore.getState().platform
}

// ─── جيب الـ platform من Firestore مباشرة ────────────────
async function fetchPlatform() {
  try {
    const snap = await getDoc(PLATFORM_DOC())
    if (snap.exists()) return snap.data()
  } catch {}
  return getLatestPlatform()
}

const OWNER_EMAIL = import.meta.env.VITE_OWNER_EMAIL || 'owner@coffeeerp.app'

export function useAuth() {
  const { setCurrentUser } = useStore()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // ── Login ─────────────────────────────────────────────────
  const login = async (email, password) => {
    setError(''); setLoading(true)
    const em = email.trim().toLowerCase()

    if (!checkRateLimit(em)) {
      setError('محاولات كثيرة. انتظر دقيقة ثم حاول.')
      setLoading(false)
      return false
    }

    try {
      // ── 1. جرب Firebase Auth (Owner + Admins) ─────────────
      let firebaseCred = null
      try {
        firebaseCred = await signInWithEmailAndPassword(auth, em, password)
      } catch (authErr) {
        if (['auth/user-not-found','auth/invalid-credential','auth/wrong-password'].includes(authErr.code)) {
          firebaseCred = null
        } else {
          throw authErr
        }
      }

      if (firebaseCred) {
        // Owner
        if (em === OWNER_EMAIL) {
          setCurrentUser({
            uid: firebaseCred.user.uid, email: em,
            role: 'super_admin', cafeId: null, cafeName: null,
            displayName: 'مالك المنصة'
          })
          return true
        }

        // Admin — اجيب أحدث platform من Firestore مباشرة
        const platform = await fetchPlatform()

        // حدّث الـ store بالبيانات الجديدة
        if (platform) useStore.getState().setPlatform(platform)

        const tenant = (platform?.tenants || []).find(
          t => t.adminEmail?.toLowerCase() === em
        )

        if (tenant) {
          if (tenant.status !== 'active') {
            await fbSignOut(auth); setError('اشتراك الكافيه موقوف.'); return false
          }
          if (tenant.subscriptionEnds && new Date(tenant.subscriptionEnds) < new Date()) {
            await fbSignOut(auth); setError('انتهى اشتراك الكافيه.'); return false
          }
          setCurrentUser({
            uid: firebaseCred.user.uid, email: em,
            role: 'admin', cafeId: tenant.id, cafeName: tenant.name,
            displayName: `مدير — ${tenant.name}`
          })
          return true
        }

        // Firebase Auth نجح بس مش في tenants
        await fbSignOut(auth)
        setError('هذا الحساب غير مسجل في النظام. تواصل مع مالك المنصة.')
        return false
      }

      // ── 2. Cashier ────────────────────────────────────────
      const hashed   = await hashPassword(password)
      const platform = await fetchPlatform()
      if (platform) useStore.getState().setPlatform(platform)

      for (const t of (platform?.tenants || [])) {
        const found = (t.cashiers || []).find(c =>
          c.email?.toLowerCase() === em &&
          c.passwordHash === hashed &&
          c.active !== false
        )
        if (found) {
          if (t.status !== 'active') { setError('اشتراك الكافيه موقوف.'); return false }
          if (t.subscriptionEnds && new Date(t.subscriptionEnds) < new Date()) {
            setError('انتهى اشتراك الكافيه.'); return false
          }
          await signInAnonymously(auth)
          setCurrentUser({
            uid: found.id, email: em, role: 'cashier',
            cafeId: t.id, cafeName: t.name,
            displayName: `${found.name} — ${t.name}`,
            cashierId: found.id,
          })
          return true
        }
      }

      setError('البريد الإلكتروني أو كلمة المرور غير صحيحة.')
      return false

    } catch (e) {
      const msgs = {
        'auth/too-many-requests':      'محاولات كثيرة. انتظر ثم حاول.',
        'auth/network-request-failed': 'تحقق من الاتصال بالإنترنت.',
        'auth/invalid-email':          'صيغة البريد غير صحيحة.',
      }
      setError(msgs[e.code] || `خطأ: ${e.message}`)
      return false
    } finally {
      setLoading(false)
    }
  }

  // ── Logout ────────────────────────────────────────────────
  const logout = async () => {
    try { await fbSignOut(auth) } catch {}
    setCurrentUser(null)
  }

  // ── Cashier management ────────────────────────────────────
  const saveCashier = async ({ tenantId, cashier }) => {
    const platform = getLatestPlatform()
    const tenants  = platform?.tenants || []
    const tenant   = tenants.find(t => t.id === tenantId)
    if (!tenant) return { ok: false, error: 'الكافيه غير موجود' }

    const cashiers  = tenant.cashiers || []
    const duplicate = cashiers.find(c =>
      c.email?.toLowerCase() === cashier.email?.toLowerCase() && c.id !== cashier.id
    )
    if (duplicate) return { ok: false, error: 'هذا الإيميل مسجل لكاشير آخر' }

    const hashed  = cashier.password ? await hashPassword(cashier.password) : null
    const updated = cashier.id
      ? cashiers.map(c => c.id === cashier.id
          ? { ...c, name: cashier.name, email: cashier.email.toLowerCase(),
              employeeId: cashier.employeeId,
              ...(hashed ? { passwordHash: hashed } : {}) }
          : c)
      : [...cashiers, {
          id: `csh_${Date.now()}`,
          name: cashier.name,
          email: cashier.email.toLowerCase(),
          passwordHash: hashed,
          employeeId: cashier.employeeId,
          active: true,
          createdAt: new Date().toISOString(),
        }]

    const newTenants = tenants.map(t => t.id === tenantId ? { ...t, cashiers: updated } : t)
    try {
      await savePlatform({ tenants: newTenants })
      useStore.getState().setPlatform({ ...platform, tenants: newTenants })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: `فشل الحفظ: ${e.message}` }
    }
  }

  const deleteCashier = async ({ tenantId, cashierId }) => {
    const platform   = getLatestPlatform()
    const tenants    = platform?.tenants || []
    const newTenants = tenants.map(t =>
      t.id === tenantId
        ? { ...t, cashiers: (t.cashiers || []).filter(c => c.id !== cashierId) }
        : t
    )
    await savePlatform({ tenants: newTenants })
    useStore.getState().setPlatform({ ...platform, tenants: newTenants })
  }

  const toggleCashier = async ({ tenantId, cashierId, active }) => {
    const platform   = getLatestPlatform()
    const tenants    = platform?.tenants || []
    const newTenants = tenants.map(t =>
      t.id === tenantId
        ? { ...t, cashiers: (t.cashiers || []).map(c => c.id === cashierId ? { ...c, active } : c) }
        : t
    )
    await savePlatform({ tenants: newTenants })
    useStore.getState().setPlatform({ ...platform, tenants: newTenants })
  }

  return { login, logout, loading, error, setError, saveCashier, deleteCashier, toggleCashier }
}
