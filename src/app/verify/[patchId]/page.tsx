import Image from "next/image";
import { CheckCircle2, ShieldCheck, Clock, MapPin, User, Scissors, Flag, Info, Mic, Tag } from "lucide-react";
import Link from "next/link";
import { VerificationCamera } from "@/components/VerificationCamera";
import { notFound } from "next/navigation";
import { VerificationClient } from "./VerificationClient";
import { prisma } from "@/lib/prisma";

export default async function VerifyPassport({ params }: { params: Promise<{ patchId: string }> }) {
  const resolvedParams = await params;
  const currentPatchId = resolvedParams.patchId;
  
  const item = await prisma.craftItem.findFirst({
    where: { patchId: currentPatchId },
    include: {
      artisan: {
        include: { artisanProfile: true }
      },
      auditLogs: {
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!item) {
    notFound();
  }

  const artisanName = item.artisan?.name || "Unknown Artisan";
  const artisanProfile = item.artisan?.artisanProfile;
  const photoUrl = artisanProfile?.photoUrl || null;
  const artisanBio = artisanProfile?.description || "An artisan from Pochampally Cooperative dedicated to handloom crafts.";
  const artisanTags = artisanProfile?.tags || ["Artisan"];
  
  return <VerificationClient item={item} patchId={currentPatchId} />;
}
