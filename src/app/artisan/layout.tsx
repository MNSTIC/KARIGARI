"use client";

import { useEffect, useState } from "react";
import { VoiceOnboarding } from "@/components/VoiceOnboarding";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function ArtisanLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          router.replace('/login');
        } else if (data.role !== 'ARTISAN') {
          router.replace(data.role === 'ADMIN' ? '/admin/facilitator' : '/login');
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-[var(--color-primary)]" size={32} />
      </div>
    );
  }

  return (
    <>
      {children}
      <VoiceOnboarding currentRoute={pathname} />
    </>
  );
}
