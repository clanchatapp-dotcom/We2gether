import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { storage } from "@/src/utils/storage";
import { setAuthUserId } from "@/src/api";

const USER_ID_KEY = "g2g_user_id";

export type Member = { user_id: string; name: string };
export type CoupleState = {
  user_id: string;
  couple_id: string;
  code: string;
  since_date: string;
  me: Member | null;
  partner: Member | null;
  paired: boolean;
};

type AuthContextType = {
  ready: boolean;
  userId: string | null;
  setSession: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  ready: false,
  userId: null,
  setSession: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const stored = await storage.secureGet<string | null>(USER_ID_KEY, null);
      if (stored) {
        setAuthUserId(stored);
        setUserId(stored);
      }
      setReady(true);
    })();
  }, []);

  const setSession = useCallback(async (id: string) => {
    setAuthUserId(id);
    await storage.secureSet(USER_ID_KEY, id);
    setUserId(id);
  }, []);

  const signOut = useCallback(async () => {
    setAuthUserId(null);
    await storage.secureRemove(USER_ID_KEY);
    setUserId(null);
  }, []);

  return (
    <AuthContext.Provider value={{ ready, userId, setSession, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
