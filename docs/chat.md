# Chat

## Overview

The Chat module provides direct messaging between a customer and a vendor, organized into `Conversation` documents (one per customer/vendor/order combination) that each contain many `Message` documents. Conversations and unread counts can be managed over REST, but real-time delivery — sending a message, marking a conversation read, and typing indicators — happens over a Socket.IO gateway namespaced at `/chat`. A `PredefinedMessage` collection supplies canned quick-reply text (e.g. greetings, order-status updates) that clients can surface as tappable shortcuts; this collection is auto-seeded on application startup if empty.

Conversation and single-conversation reads are cache-backed (via `@nestjs/cache-manager`, a global in-memory cache registered by `ChatModule` with a default TTL of 600s), and `sendMessage` takes a short-lived cache-based lock per conversation to avoid unread-counter race conditions.

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

- **REST**: The entire `ChatController` is guarded with `@UseGuards(AccessTokenGuard)` (JWT via Passport `jwt` strategy) — every REST endpoint in this module requires a valid access token. There is no per-role restriction (no `RolesGuard`/`@Roles` usage); the caller's role is read from `req.user.role` to decide behavior (e.g. which side of the conversation they are).
- **WebSocket**: `ChatGateway` (`src/modules/chat/chat.gateway.ts`) is registered at namespace **`/chat`** with `cors: { origin: '*' }`. It implements **no connection-time authentication** — there is no `handleConnection`/`OnGatewayConnection` on this gateway, no guard is applied to the gateway or its handlers, and no JWT is read from the handshake. Any socket can connect to the `/chat` namespace. Room membership is established purely by the client calling `join_conversation` with a `conversationId` it supplies itself, and `senderId`/`senderType` in `send_message` are taken as given from the payload rather than derived from a verified identity. (Contrast with the Notifications gateway, which does authenticate — see `docs/notifications.md`.)

## REST Endpoints

Global prefix `/api` + controller prefix `chat`.

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/chat/conversations` | JWT | body `{ vendorId: string, orderId?: string }`; `customerId` taken from `req.user.sub` | `{ success: true, message: "Conversation ready", data: Conversation }` | none explicit (creates if missing) |
| GET | `/api/chat/conversations` | JWT | — (role derived from `req.user.role`, `'vendor'` or else `'student'`) | `{ success: true, message: "Conversations retrieved", data: Conversation[] }` | none |
| GET | `/api/chat/predefined-messages` | JWT | query `PredefinedMessageQueryDto`: `role?: 'customer'\|'vendor'`, `category?: string` | `{ success: true, message: "Predefined messages retrieved", data: PredefinedMessage[] }` | none |
| GET | `/api/chat/conversation/:id` | JWT | path `id` | `{ success: true, data: Conversation }` | `404 NotFoundException` ("Conversation not found") if missing |
| GET | `/api/chat/conversations/:id/messages` | JWT | path `id`; query `skip` (default `0`), `limit` (default `30`) | `{ success: true, data: Message[] }` (sorted `createdAt: -1`) | none |
| PATCH | `/api/chat/read/:conversationId` | JWT | path `conversationId`; `userType` derived from `req.user.role` (`'vendor'` or else `'customer'`) | `{ success: true, message: "Marked as read" }` | none |

Notes on `POST /api/chat/conversations` (`ChatService.getOrCreateConversation`): looks up (and caches, 600s) an existing conversation matching `participants.customerId` + `participants.vendorId` (+ `orderId` if given); if none exists, creates one with `unreadCount: { customer: 0, vendor: 0 }` and `isActive: true`, then caches it.

## WebSocket Events

Namespace: **`/chat`**

### Client → Server (`@SubscribeMessage`)

| Event | Payload | Behavior | Emits back / broadcasts |
|---|---|---|---|
| `join_conversation` | `{ conversationId: string }` | `client.join(conversationId)` — joins the Socket.IO room named after the conversation ID | Returns ack `{ joined: true }` to the caller (no broadcast) |
| `send_message` | `{ conversationId: string, senderId: string, senderType: 'customer'\|'vendor', messageType: 'text'\|'predefined'\|'image', content: string }` | Calls `ChatService.sendMessage(data)`, which validates the `conversationId`, acquires a 3s cache lock keyed `lock:conversation:{id}` (throws if already locked), creates the `Message`, updates `conversation.lastMessage` and increments the recipient's `unreadCount`, then invalidates the conversation cache | Broadcasts `message_received` (payload: the created `Message` document) to room `conversationId`; also returns the message document as the ack to the sender |
| `mark_as_read` | `{ conversationId: string }` | Calls `ChatService.markConversationAsRead(conversationId)` — marks all unread messages in the conversation as read and zeroes both `unreadCount.customer` and `unreadCount.vendor` | Broadcasts `message_read` (payload: `{ conversationId, readAt: Date }`) to room `conversationId` |
| `typing` | `{ conversationId: string, userId: string, isTyping: boolean }` | No persistence — purely relayed | Broadcasts `typing_indicator` (payload: the same data object) to everyone else in room `conversationId` (`client.to(...)`, excludes sender) |

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
- `sendMessage` locking: a per-conversation lock (`lock:conversation:{conversationId}`, 3-second TTL) prevents concurrent `send_message` calls on the same conversation from racing on `unreadCount` updates; a request made while locked receives `403 ForbiddenException` ("Message is being processed, try again").
- Unread counts are incremented per recipient: a message from a `customer` increments `unreadCount.vendor`; a message from a `vendor` increments `unreadCount.customer`.
