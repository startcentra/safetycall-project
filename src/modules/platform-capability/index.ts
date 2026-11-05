/** v1.36 capability contract. Design-time information only; NOT native device detection. */
export type Platform='WEB'|'ANDROID'|'IOS';
export const PLATFORM_CAPABILITIES=Object.freeze({
 WEB:{platform:'WEB',inAppMockFiltering:'IMPLEMENTED',nativeSmsRead:'UNSUPPORTED',
   nativeSmsFilter:'UNSUPPORTED',imessage:'UNSUPPORTED',rcs:'UNSUPPORTED',thirdPartyLinks:'UNSUPPORTED',
   actualCallAudio:'UNSUPPORTED',nativeAdapterInstalled:false,policyEnforcement:'MOCK_ONLY'},
 ANDROID:{platform:'ANDROID',inAppMockFiltering:'IMPLEMENTED',nativeSmsRead:'CONDITIONAL_DEFAULT_SMS_ROLE_AND_PLAY_POLICY',
   nativeSmsFilter:'CONDITIONAL_NATIVE_APP_NOT_PRESENT',imessage:'UNSUPPORTED',
   rcs:'NOT_VERIFIED_PROVIDER_DEPENDENT',thirdPartyLinks:'UNSUPPORTED',actualCallAudio:'NOT_VERIFIED_PLATFORM_DEPENDENT',
   nativeAdapterInstalled:false,policyEnforcement:'MOCK_ONLY'},
 IOS:{platform:'IOS',inAppMockFiltering:'IMPLEMENTED',nativeSmsRead:'UNSUPPORTED_FOR_THIRD_PARTY_WEB',
   nativeSmsFilter:'CONDITIONAL_IDENTITYLOOKUP_UNKNOWN_SENDER_SMS_MMS_ONLY',imessage:'UNSUPPORTED_BY_IDENTITYLOOKUP',
   rcs:'NOT_VERIFIED',thirdPartyLinks:'UNSUPPORTED',actualCallAudio:'NOT_VERIFIED_PLATFORM_DEPENDENT',
   nativeAdapterInstalled:false,policyEnforcement:'MOCK_ONLY'},
});
/** User-agent strings cannot establish native entitlements or SMS/filter status. */
export function resolvePlatformCapability(platform:Platform){
 if(!Object.hasOwn(PLATFORM_CAPABILITIES,platform))throw Error('INVALID_PLATFORM');
 return PLATFORM_CAPABILITIES[platform];
}
