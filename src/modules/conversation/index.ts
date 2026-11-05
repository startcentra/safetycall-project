export type ConversationEvent =
  | { type: "CONVERSATION_STARTED"; sessionId: string; at: string }
  | { type: "UTTERANCE_RECEIVED"; sessionId: string; utteranceId: string; sequenceNumber: number; at: string }
  | { type: "CONVERSATION_ENDED"; sessionId: string; at: string };
// M2 demo state machine is in modules/simulation/engine.ts.
