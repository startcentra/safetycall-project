import {NextResponse} from 'next/server';
import {serverCostGuard} from '@/modules/cost/guard';
export const runtime='nodejs';export const dynamic='force-dynamic';
export function GET() {try {return NextResponse.json({mode:'LOCAL_APP_LEDGER_NOT_META_BILLING',...serverCostGuard().stats(),creditReferenceUsd:150,reserveUsd:40},{headers:{'Cache-Control':'no-store'}})} catch {return NextResponse.json({error:'예산 장부를 읽을 수 없습니다. LIVE 차단 권장'},{status:503})}}
