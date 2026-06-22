import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoogleUser {
  sub: string;       // unique user ID
  name: string;
  email: string;
  picture: string;
  given_name: string;
  family_name: string;
}

interface AuthContextType {
  user: GoogleUser | null;
  loading: boolean;
  login: (credentialResponse: { credential?: string }) => void;
  logout: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = 'geo_intel_user';

// ─── Provider ─────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: GoogleUser = JSON.parse(stored);
        setUser(parsed);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback((credentialResponse: { credential?: string }) => {
    if (!credentialResponse.credential) throw new Error('No credential received.');
    
    const decoded = jwtDecode<GoogleUser>(credentialResponse.credential);
    
    const domain = decoded.email.split('@')[1]?.toLowerCase() ?? '';
    const allowed = domain === 'econz.net' || domain.endsWith('.econz.net');
    if (!allowed) {
      throw new Error('Access restricted: Only econz.net accounts are allowed.');
    }
    
    setUser(decoded);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decoded));
  }, []);

  const logout = useCallback(() => {
    googleLogout();
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
