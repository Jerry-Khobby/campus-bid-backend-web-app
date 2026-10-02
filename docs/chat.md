# Chat

## Overview

The Chat module provides direct messaging between a customer and a vendor, organized into `Conversation` documents (one per customer/vendor/order combination) that each contain many `Message` documents. Conversations and unread counts can be managed over REST, but real-time delivery — sending a message, marking a conversation read, and typing indicators — happens over a Socket.IO gateway namespaced at `/chat`. A `PredefinedMessage` collection supplies canned quick-reply text (e.g. greetings, order-status updates) that clients can surface as tappable shortcuts; this collection is auto-seeded on application startup if empty.

Conversation and single-conversation reads are cache-backed (via `@nestjs/cache-manager`, a global in-memory cache registered by `ChatModule` with a default TTL of 600s). `sendMessage` no longer uses a cache-based lock — its unread-counter update is now a single atomic `updateOne` (see **Business Rules**).

Every read or write of a conversation, its messages, or its unread counters now verifies the caller is actually one of the conversation's two participants — this did not used to be true (see **Authentication**).

## Data Model

### Conversation (`src/modules/chat/schema/conversation.schema.ts`)

| Field | Type | Notes |
|---|---|---|
| `participants.customerId` | ObjectId (ref `User`) | required |
| `participants.vendorId` | ObjectId (ref `Vendor`) | required |
| `orderId` | ObjectId (ref `Order`) | optional; links the conversation to an order |
| `lastMessage.text` | String | denormalized preview of the latest message (`[Image]` if the last message was an image) |
| `lastMessage.senderId` | ObjectId (ref `User`) | |
| `lastMessage.timestamp` | Date | |
| `unreadCount.customer` | Number | default `0` |
| `unreadCount.vendor` | Number | default `0` |
| `isActive` | Boolean | default `true` |
| `createdAt` / `updatedAt` | Date | `timestamps: true` |

Indexes: `{ 'participants.customerId': 1 }`, `{ 'participants.vendorId': 1 }`, `{ orderId: 1 }`, `{ updatedAt: -1 }`.

### Message (`src/modules/chat/schema/message.schema.ts`)

| Field | Type | Notes |
|---|---|---|
| `conversationId` | ObjectId (ref `Conversation`) | required, indexed |
| `senderId` | ObjectId | required |
| `senderType` | enum `customer` \| `vendor` | required |
| `messageType` | enum `text` \| `predefined` \| `image` | required |
| `content` | String | required — text, predefined text, or image URL |
| `predefinedMessageId` | String | optional |
| `isRead` | Boolean | default `false` |
| `readAt` | Date | optional |
| `createdAt` | Date | `timestamps: { createdAt: true, updatedAt: false }` |

Indexes: `{ conversationId: 1, createdAt: 1 }`, `{ senderId: 1 }`.

### PredefinedMessage (`src/modules/chat/schema/predefined-message.schema.ts`)

| Field | Type | Notes |
|---|---|---|
| `role` | enum `customer` \| `vendor` \| `both` | required |
| `category` | String | required (e.g. `greeting`, `order_update`, `inquiry`) |
| `text` | String | required |
| `isActive` | Boolean | default `true` |
| `sortOrder` | Number | default `0` |
| `createdAt` | Date | `timestamps: { createdAt: true, updatedAt: false }` |

Index: `{ role: 1, category: 1 }`.

## Authentication

- **REST**: The entire `ChatController` is guarded with `@UseGuards(AccessTokenGuard)` (JWT via Passport `jwt` strategy) — every REST endpoint in this module requires a valid access token. There is no per-role restriction (no `RolesGuard`/`@Roles` usage); the caller's identity is converted to a `ChatParticipant` (`{ id, type: 'customer' | 'vendor' }`, via `toChatParticipant(req.user)` in `src/modules/chat/chat-participant.ts`) and checked against the conversation's actual participants on every read/write — see **Authorization** below.
- **WebSocket**: `ChatGateway` (`src/modules/chat/chat.gateway.ts`) is registered at namespace **`/chat`**, authenticated via the shared `SocketAuthService` (`src/modules/notifications/socket-auth/`, same service the Notifications gateway uses) applied as namespace middleware (`afterInit`) — a socket cannot connect at all without a valid JWT, and allowed origins are restricted (no more `cors: { origin: '*' }`). This closes what used to be a complete authentication gap: previously, any socket could connect to `/chat` with no token at all, and `senderId`/`senderType` in `send_message` were taken directly from the client-supplied payload rather than a verified identity — meaning any connected socket could send a message *as any other user*. Sender identity is now always derived from the authenticated socket (`this.participantOf(client)`), never from the payload.

### Authorization — participant checks

Every conversation read/write now goes through `ChatService.getConversationForParticipant(conversationId, participant)`, which loads the conversation and throws `403 ForbiddenException("You are not a participant in this conversation")` unless `participant` matches either `participants.customerId` or `participants.vendorId` (`isParticipant()` in `chat-participant.ts`). This did not used to be true: `GET /chat/conversation/:id`, `GET /chat/conversations/:id/messages`, `PATCH /chat/read/:conversationId`, `send_message`, and `mark_as_read` all previously operated on any `conversationId` supplied by the caller with no check that they were actually part of it — any authenticated user (or, worse, any unauthenticated socket) could read or manipulate any conversation by guessing/iterating its id. `join_conversation` now runs the same check before letting a socket join the Socket.IO room, and `typing` only broadcasts for a socket that's actually in the room (i.e. already passed that check).

## REST Endpoints

Global prefix `/api` + controller prefix `chat`.

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/chat/conversations` | JWT, role `student` | body `CreateConversationDto`: `vendorId` (MongoId, required), `orderId` (MongoId, optional); `customerId` taken from `req.user.sub` | `{ success: true, message: "Conversation ready", data: Conversation }` | none explicit (creates if missing) |
| GET | `/api/chat/conversations` | JWT | — (participant derived from `req.user`) | `{ success: true, message: "Conversations retrieved", data: Conversation[] }` | none |
| GET | `/api/chat/predefined-messages` | JWT | query `PredefinedMessageQueryDto`: `role?: 'customer'\|'vendor'`, `category?: string` | `{ success: true, message: "Predefined messages retrieved", data: PredefinedMessage[] }` | none |
| GET | `/api/chat/conversation/:id` | JWT | path `id` | `{ success: true, data: Conversation }` | `404 NotFoundException` if missing; `400 BadRequestException` if `id` isn't a valid ObjectId; `403 ForbiddenException` if the caller isn't a participant |
| GET | `/api/chat/conversations/:id/messages` | JWT | path `id`; query `MessagesPageQueryDto`: `skip` (int ≥0, default `0`), `limit` (int, 1–100, default `30`) | `{ success: true, data: Message[] }` (sorted `createdAt: -1`) | same as above (participant check runs first) |
| PATCH | `/api/chat/read/:conversationId` | JWT | path `conversationId` | `{ success: true, message: "Marked as read" }` | same as above |

Notes on `POST /api/chat/conversations` (`ChatService.getOrCreateConversation`): looks up (and caches, 600s) an existing conversation matching `participants.customerId` + `participants.vendorId` (+ `orderId` if given); if none exists, creates one with `unreadCount: { customer: 0, vendor: 0 }` and `isActive: true`, then caches it. `POST` is now restricted to `role: 'student'` — a vendor can't initiate a new conversation through this route (only reply within one a customer already started).

## WebSocket Events

Namespace: **`/chat`**

### Client → Server (`@SubscribeMessage`)

| Event | Payload | Behavior | Emits back / broadcasts |
|---|---|---|---|
| `join_conversation` | `ConversationRefDto`: `{ conversationId: string }` | Verifies the authenticated socket is a participant in `conversationId` (`getConversationForParticipant`, throws if not), then joins the Socket.IO room named after the conversation ID | Returns ack `{ joined: true }` to the caller (no broadcast) |
| `send_message` | `SendMessageDto`: `{ conversationId, messageType: 'text'\|'predefined'\|'image', content (≤2000 chars), predefinedMessageId? }` — **no `senderId`/`senderType` field**; sender is always derived from the authenticated socket | Calls `ChatService.sendMessage(participant, dto)` — verifies participantship, creates the `Message`, then a **single atomic `updateOne`** sets `conversation.lastMessage` and `$inc`s the recipient's `unreadCount` in one write (replacing the old cache-lock-and-reject approach — see Business Rules) | Broadcasts `message_received` (payload: the created `Message` document) to room `conversationId`; also returns the message document as the ack to the sender |
| `mark_as_read` | `ConversationRefDto`: `{ conversationId: string }` | Calls `ChatService.markAsRead(conversationId, participant)` — verifies participantship, marks only messages **from the other participant** as read, and zeroes only the caller's own `unreadCount` (see Business Rules for why this changed) | Broadcasts `message_read` (payload: `{ conversationId, readAt: Date }`) to room `conversationId` |
| `typing` | `TypingDto`: `{ conversationId: string, isTyping: boolean }` — **no `userId` field**; the recipient infers who's typing from which room/socket emitted it | No persistence; only relayed if the socket is already in that room (`client.rooms.has(conversationId)`, i.e. it already passed `join_conversation`'s participant check) — otherwise throws `WsException("Join the conversation first")` | Broadcasts `typing_indicator` (payload: `{ conversationId, isTyping }`) to everyone else in room `conversationId` (`client.to(...)`, excludes sender) |

### Server → Client (emitted events)

| Event | Payload | Trigger |
|---|---|---|
| `message_received` | `Message` document | Emitted by `ChatGateway.handleSendMessage` to room `conversationId` whenever a `send_message` event is handled |
| `message_read` | `{ conversationId: string, readAt: Date }` | Emitted by `ChatGateway.handleMarkAsRead` to room `conversationId` whenever a `mark_as_read` event is handled |
| `typing_indicator` | `{ conversationId, userId, isTyping }` | Emitted by `ChatGateway.handleTyping`, relaying a `typing` event to the rest of the room |

There are no cross-module emitters into the chat gateway (unlike Notifications' `new_notification`) — all chat events originate from `ChatGateway` itself in response to client-initiated events.

## Business Rules & Notes

- **Predefined message seeding** (`ChatService.onModuleInit`, invoked automatically by Nest's `OnModuleInit` lifecycle hook when the module starts): counts documents in the `PredefinedMessage` collection; **only if the count is `0`** does it `insertMany(DEFAULT_PREDEFINED_MESSAGES)` from `src/modules/chat/predefined-messages.seed.ts`. If any predefined messages already exist, seeding is skipped entirely — it never tops up or updates existing entries.
- The seed data (`DEFAULT_PREDEFINED_MESSAGES`) contains 6 entries covering `role`s `customer`, `vendor`, and `both`, across categories `greeting`, `order_update`, and `inquiry`, each with an explicit `sortOrder`.
- **`sendMessage` no longer locks.** The previous cache-based lock (`lock:conversation:{id}`, 3s TTL, rejecting a second concurrent send with `403 ForbiddenException`) is gone — it was both a correctness workaround (the old code did a read-modify-save of `unreadCount` that could lose an increment under a real race) and user-hostile (it rejected the *second* of two legitimate rapid messages instead of queuing it). The replacement is a single atomic `$inc`/`$set` `updateOne`, which can't lose an increment and never needs to reject a concurrent send.
- Unread counts are incremented per recipient: a message from a `customer` increments `unreadCount.vendor`; a message from a `vendor` increments `unreadCount.customer`.
- **`markAsRead` semantics changed.** It used to mark *every* unread message in the conversation as read and zero *both* `unreadCount.customer` and `unreadCount.vendor`, regardless of who called it — so a customer calling "mark as read" would also clear the vendor's unread badge for messages the vendor hadn't actually seen. It now only marks messages sent by the **other** participant as read, and only zeroes the **caller's own** unread counter — a customer reading a conversation no longer affects what the vendor sees as unread, and vice versa.
