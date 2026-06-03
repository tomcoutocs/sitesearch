"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  normalizeOutreachEmail,
  type OutreachContact,
  type OutreachStatus,
} from "@/lib/outreach-contacts";

type OutreachContextValue = {
  contacts: OutreachContact[];
  configured: boolean;
  loading: boolean;
  error: string | null;
  contactedByEmail: Map<string, OutreachContact>;
  refresh: () => Promise<void>;
  updateContact: (
    id: string,
    patch: { status?: OutreachStatus; notes?: string | null },
  ) => Promise<boolean>;
  addContact: (contact: OutreachContact) => void;
};

const OutreachContext = createContext<OutreachContextValue | null>(null);

export function OutreachProvider({ children }: { children: ReactNode }) {
  const [contacts, setContacts] = useState<OutreachContact[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/outreach");
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Could not load outreach history");
      }

      const data = (await res.json()) as {
        configured: boolean;
        contacts: OutreachContact[];
      };

      setConfigured(data.configured);
      setContacts(data.contacts ?? []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load outreach history",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const contactedByEmail = useMemo(() => {
    const map = new Map<string, OutreachContact>();
    for (const contact of contacts) {
      map.set(contact.email_normalized, contact);
    }
    return map;
  }, [contacts]);

  const updateContact = useCallback(
    async (
      id: string,
      patch: { status?: OutreachStatus; notes?: string | null },
    ) => {
      const res = await fetch(`/api/outreach/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Could not update contact");
        return false;
      }

      const data = (await res.json()) as { contact: OutreachContact };
      setContacts((prev) =>
        prev.map((contact) => (contact.id === id ? data.contact : contact)),
      );
      setError(null);
      return true;
    },
    [],
  );

  const addContact = useCallback((contact: OutreachContact) => {
    setContacts((prev) => {
      const normalized = normalizeOutreachEmail(contact.email);
      if (prev.some((row) => row.email_normalized === normalized)) {
        return prev;
      }
      return [contact, ...prev];
    });
  }, []);

  const value = useMemo(
    () => ({
      contacts,
      configured,
      loading,
      error,
      contactedByEmail,
      refresh,
      updateContact,
      addContact,
    }),
    [
      contacts,
      configured,
      loading,
      error,
      contactedByEmail,
      refresh,
      updateContact,
      addContact,
    ],
  );

  return (
    <OutreachContext.Provider value={value}>{children}</OutreachContext.Provider>
  );
}

export function useOutreach() {
  const context = useContext(OutreachContext);
  if (!context) {
    throw new Error("useOutreach must be used within OutreachProvider");
  }
  return context;
}
