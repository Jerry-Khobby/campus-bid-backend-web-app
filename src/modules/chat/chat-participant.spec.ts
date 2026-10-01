import { isParticipant, toChatParticipant } from './chat-participant';

describe('chat participant', () => {
  const conversation = { participants: { customerId: 'customer-1', vendorId: 'vendor-1' } };

  it('maps a vendor token to a vendor participant', () => {
    expect(toChatParticipant({ sub: 'vendor-1', role: 'vendor' })).toEqual({ id: 'vendor-1', type: 'vendor' });
  });

  it('maps a student token to a customer participant', () => {
    expect(toChatParticipant({ sub: 'customer-1', role: 'student' })).toEqual({ id: 'customer-1', type: 'customer' });
  });

  it('recognises the customer of the conversation', () => {
    expect(isParticipant(conversation, { id: 'customer-1', type: 'customer' })).toBe(true);
  });

  it('recognises the vendor of the conversation', () => {
    expect(isParticipant(conversation, { id: 'vendor-1', type: 'vendor' })).toBe(true);
  });

  it('rejects a user outside the conversation', () => {
    expect(isParticipant(conversation, { id: 'customer-2', type: 'customer' })).toBe(false);
  });

  it('rejects a participant id presented with the other role', () => {
    expect(isParticipant(conversation, { id: 'vendor-1', type: 'customer' })).toBe(false);
  });
});
