/** Ephemeral *fixture* classifier. Never validates actual presence inside a bank. */
export type GeoContext=Readonly<{
  userConsented:boolean;observationAtMs:number|null;accuracyMeters:number|null;
  distanceToVerifiedPoiMeters:number|null;bankPoiSourceVerified:boolean;
  nowMs:number;
}>;
export type GeoContextResult='NO_CONSENT'|'NO_LOCATION'|'STALE'|'INACCURATE'|'POI_UNVERIFIED'|'NEAR_POSSIBLE'|'FAR'|'UNCERTAIN';
export function classifyBankProximity(context:GeoContext):GeoContextResult {
  if(!context.userConsented)return 'NO_CONSENT';
  if(context.observationAtMs===null||context.accuracyMeters===null)return 'NO_LOCATION';
  if(![context.nowMs,context.observationAtMs,context.accuracyMeters].every(Number.isFinite)||
    context.observationAtMs>context.nowMs+2000||context.nowMs-context.observationAtMs>60_000)return 'STALE';
  if(context.accuracyMeters<0||context.accuracyMeters>100)return 'INACCURATE';
  if(!context.bankPoiSourceVerified||context.distanceToVerifiedPoiMeters===null)return 'POI_UNVERIFIED';
  const d=context.distanceToVerifiedPoiMeters;
  if(!Number.isFinite(d)||d<0)return 'UNCERTAIN';
  // Conservative entire accuracy circle falls inside 250 m. Still NOT arrival evidence.
  if(d+context.accuracyMeters<=250)return 'NEAR_POSSIBLE';
  if(d-context.accuracyMeters>250)return 'FAR';
  return 'UNCERTAIN';
}
