import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

/** Reads the auth cookie, so it must never be statically optimised. */
export const dynamic = 'force-dynamic';


export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token.value, process.env.JWT_SECRET || 'fallback-secret');
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all logs for items assigned to this admin (or all if we want platform-wide compliance)
    // For a compliance report, usually it's platform-wide or specific to their cooperative. 
    // We will fetch all logs related to this admin's assigned items.
    
    const logs = await prisma.auditLog.findMany({
      where: {
        craftItem: {
          OR: [
            { assignedAdminId: decoded.userId },
            { patchId: { not: null } } // fallback
          ]
        }
      },
      include: {
        craftItem: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Generate CSV
    let csvContent = "Timestamp,Patch ID,Craft Type,Action,Actor Role,Details\n";
    
    logs.forEach(log => {
      const timestamp = new Date(log.createdAt).toISOString();
      const patchId = log.craftItem.patchId || log.craftItem.id;
      const craftType = log.craftItem.craftType.replace(/,/g, ''); // prevent csv break
      const action = log.action;
      const actor = log.actorRole;
      const details = (log.comments || "").replace(/,/g, ';').replace(/\n/g, ' '); // sanitize
      
      csvContent += `${timestamp},${patchId},${craftType},${action},${actor},${details}\n`;
    });

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="karigari_compliance_report.csv"'
      }
    });

  } catch (error: any) {
    console.error('Export Error:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
