export const DEFAULT_PREDEFINED_MESSAGES = [
  { role: 'customer', category: 'greeting', text: 'Hello! Is my order ready?', sortOrder: 0 },
  { role: 'vendor', category: 'greeting', text: 'Hi! Thanks for reaching out, how can I help?', sortOrder: 0 },
  { role: 'vendor', category: 'order_update', text: 'Your order is being prepared now.', sortOrder: 1 },
  { role: 'vendor', category: 'order_update', text: 'Your order is ready for pickup/delivery.', sortOrder: 2 },
  { role: 'customer', category: 'inquiry', text: 'Do you have this item in stock?', sortOrder: 1 },
  { role: 'both', category: 'inquiry', text: 'Can you share more details, please?', sortOrder: 2 },
];
