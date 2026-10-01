import { Types } from 'mongoose';

export type ParticipantType = 'customer' | 'vendor';

/** The verified identity acting on a conversation, always derived from the access token. */
export interface ChatParticipant {
  id: string;
  type: ParticipantType;
}

interface TokenUser {
  sub: string;
  role: string;
}

interface ConversationParticipants {
  participants: {
    customerId: Types.ObjectId | string;
    vendorId: Types.ObjectId | string;
  };
}

const VENDOR_ROLE = 'vendor';

export function toChatParticipant(user: TokenUser): ChatParticipant {
  return { id: user.sub, type: user.role === VENDOR_ROLE ? 'vendor' : 'customer' };
}

// Cached conversations come back as plain JSON, so ids are compared as strings.
export function isParticipant(conversation: ConversationParticipants, participant: ChatParticipant): boolean {
  const { customerId, vendorId } = conversation.participants;
  const expectedId = participant.type === 'vendor' ? vendorId : customerId;

  return String(expectedId) === participant.id;
}
