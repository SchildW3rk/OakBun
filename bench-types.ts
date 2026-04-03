// tsc --diagnostics benchmark — 150 typed routes across 10 modules
// Run: node_modules/.bin/tsc --noEmit --diagnostics --project tsconfig.bench.json
//
// Enterprise-scale stress test:
//   10 modules × 15 routes = 150 typed routes
//   Full CRUD + custom actions + nested params + query schemas per module

import { z } from 'zod'
import { createApp } from './packages/core/src/app/index'
import { defineModule } from './packages/core/src/app/module'
import { createProxyClient } from './packages/core/src/client/proxy'

// ── Shared schemas ─────────────────────────────────────────────────────────────

const UserSchema = z.object({
  id:        z.number(),
  name:      z.string(),
  email:     z.string(),
  role:      z.string(),
  createdAt: z.string(),
})

const ItemSchema = z.object({
  id:     z.number(),
  name:   z.string(),
  price:  z.number(),
  active: z.boolean(),
})

const OrderSchema = z.object({
  id:        z.number(),
  userId:    z.number(),
  total:     z.number(),
  status:    z.string(),
  createdAt: z.string(),
})

const ProductSchema = z.object({
  id:       z.number(),
  name:     z.string(),
  slug:     z.string(),
  price:    z.number(),
  stock:    z.number(),
  category: z.string(),
})

const InvoiceSchema = z.object({
  id:        z.number(),
  orderId:   z.number(),
  amount:    z.number(),
  dueDate:   z.string(),
  paid:      z.boolean(),
})

const ReviewSchema = z.object({
  id:        z.number(),
  productId: z.number(),
  userId:    z.number(),
  rating:    z.number(),
  comment:   z.string(),
})

const CategorySchema = z.object({
  id:       z.number(),
  name:     z.string(),
  slug:     z.string(),
  parentId: z.number().nullable(),
})

const NotificationSchema = z.object({
  id:        z.number(),
  userId:    z.number(),
  type:      z.string(),
  read:      z.boolean(),
  createdAt: z.string(),
})

const AuditLogSchema = z.object({
  id:        z.number(),
  actor:     z.string(),
  action:    z.string(),
  resource:  z.string(),
  createdAt: z.string(),
})

const WebhookSchema = z.object({
  id:      z.number(),
  url:     z.string(),
  events:  z.array(z.string()),
  active:  z.boolean(),
  secret:  z.string(),
})

// ── Module 1: /api/users — 15 routes ──────────────────────────────────────────

const usersModule = defineModule('/api/users')
  .get('/', {
    response: z.array(UserSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: UserSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', email: '', role: '', createdAt: '' }),
  })
  .post('/', {
    body:     z.object({ name: z.string(), email: z.string() }),
    response: UserSchema,
    handler:  (ctx) => ctx.json({ id: 1, name: ctx.body.name, email: ctx.body.email, role: 'user', createdAt: '' }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ name: z.string().optional(), email: z.string().optional() }),
    response: UserSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', email: '', role: '', createdAt: '' }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: UserSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', email: '', role: '', createdAt: '' }),
  })
  .get('/search', {
    query:    z.object({ q: z.string(), role: z.string().optional() }),
    response: z.array(UserSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/:id/ban', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ reason: z.string() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .post('/:id/restore', {
    params:   z.object({ id: z.coerce.number() }),
    response: UserSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', email: '', role: '', createdAt: '' }),
  })
  .get('/export', {
    query:    z.object({ format: z.enum(['csv', 'json']) }),
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), active: z.number(), banned: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, active: 0, banned: 0 }),
  })
  .get('/:id/orders', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.array(OrderSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/:id/verify-email', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ token: z.string() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .patch('/:id/role', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ role: z.string() }),
    response: UserSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', email: '', role: ctx.body.role, createdAt: '' }),
  })
  .get('/me', {
    response: UserSchema,
    handler:  (ctx) => ctx.json({ id: 0, name: '', email: '', role: '', createdAt: '' }),
  })
  .post('/bulk-invite', {
    body:     z.object({ emails: z.array(z.string()) }),
    response: z.object({ invited: z.number() }),
    handler:  (ctx) => ctx.json({ invited: ctx.body.emails.length }),
  })

// ── Module 2: /api/items — 15 routes ──────────────────────────────────────────

const itemsModule = defineModule('/api/items')
  .get('/', {
    response: z.array(ItemSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', price: 0, active: true }),
  })
  .post('/', {
    body:     z.object({ name: z.string(), price: z.number() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: 1, name: ctx.body.name, price: ctx.body.price, active: true }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ name: z.string().optional(), price: z.number().optional() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', price: 0, active: true }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', price: 0, active: true }),
  })
  .post('/:id/activate', {
    params:   z.object({ id: z.coerce.number() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', price: 0, active: true }),
  })
  .post('/:id/deactivate', {
    params:   z.object({ id: z.coerce.number() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', price: 0, active: false }),
  })
  .get('/search', {
    query:    z.object({ q: z.string(), minPrice: z.string().optional(), maxPrice: z.string().optional() }),
    response: z.array(ItemSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/export', {
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), active: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, active: 0 }),
  })
  .get('/:id/reviews', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.array(ReviewSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/:id/duplicate', {
    params:   z.object({ id: z.coerce.number() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id + 1, name: '', price: 0, active: true }),
  })
  .patch('/:id/price', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ price: z.number() }),
    response: ItemSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', price: ctx.body.price, active: true }),
  })
  .get('/low-stock', {
    query:    z.object({ threshold: z.string().optional() }),
    response: z.array(ItemSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/bulk-update', {
    body:     z.object({ ids: z.array(z.number()), data: z.object({ active: z.boolean().optional() }) }),
    response: z.object({ updated: z.number() }),
    handler:  (ctx) => ctx.json({ updated: ctx.body.ids.length }),
  })

// ── Module 3: /api/orders — 15 routes ─────────────────────────────────────────

const ordersModule = defineModule('/api/orders')
  .get('/', {
    response: z.array(OrderSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: OrderSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, total: 0, status: '', createdAt: '' }),
  })
  .post('/', {
    body:     z.object({ userId: z.number(), items: z.array(z.object({ id: z.number(), qty: z.number() })) }),
    response: OrderSchema,
    handler:  (ctx) => ctx.json({ id: 1, userId: ctx.body.userId, total: 0, status: 'pending', createdAt: '' }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ status: z.string() }),
    response: OrderSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, total: 0, status: ctx.body.status, createdAt: '' }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: OrderSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, total: 0, status: '', createdAt: '' }),
  })
  .post('/:id/cancel', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ reason: z.string() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .post('/:id/fulfill', {
    params:   z.object({ id: z.coerce.number() }),
    response: OrderSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, total: 0, status: 'fulfilled', createdAt: '' }),
  })
  .get('/by-user/:userId', {
    params:   z.object({ userId: z.coerce.number() }),
    response: z.array(OrderSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/export', {
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), revenue: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, revenue: 0 }),
  })
  .post('/:id/refund', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ amount: z.number(), reason: z.string() }),
    response: z.object({ ok: z.boolean(), refundId: z.string() }),
    handler:  (ctx) => ctx.json({ ok: true, refundId: 'ref_1' }),
  })
  .get('/:id/invoice', {
    params:   z.object({ id: z.coerce.number() }),
    response: InvoiceSchema,
    handler:  (ctx) => ctx.json({ id: 1, orderId: ctx.params.id, amount: 0, dueDate: '', paid: false }),
  })
  .patch('/:id/address', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ street: z.string(), city: z.string(), zip: z.string() }),
    response: OrderSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, total: 0, status: '', createdAt: '' }),
  })
  .get('/pending', {
    response: z.array(OrderSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/bulk-cancel', {
    body:     z.object({ ids: z.array(z.number()), reason: z.string() }),
    response: z.object({ cancelled: z.number() }),
    handler:  (ctx) => ctx.json({ cancelled: ctx.body.ids.length }),
  })

// ── Module 4: /api/products — 15 routes ───────────────────────────────────────

const productsModule = defineModule('/api/products')
  .get('/', {
    response: z.array(ProductSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: ProductSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', price: 0, stock: 0, category: '' }),
  })
  .post('/', {
    body:     z.object({ name: z.string(), slug: z.string(), price: z.number(), category: z.string() }),
    response: ProductSchema,
    handler:  (ctx) => ctx.json({ id: 1, name: ctx.body.name, slug: ctx.body.slug, price: ctx.body.price, stock: 0, category: ctx.body.category }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ name: z.string().optional(), price: z.number().optional() }),
    response: ProductSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', price: 0, stock: 0, category: '' }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: ProductSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', price: 0, stock: 0, category: '' }),
  })
  .get('/search', {
    query:    z.object({ q: z.string(), category: z.string().optional() }),
    response: z.array(ProductSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/by-category/:categoryId', {
    params:   z.object({ categoryId: z.coerce.number() }),
    response: z.array(ProductSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/:id/publish', {
    params:   z.object({ id: z.coerce.number() }),
    response: ProductSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', price: 0, stock: 0, category: '' }),
  })
  .post('/:id/unpublish', {
    params:   z.object({ id: z.coerce.number() }),
    response: ProductSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', price: 0, stock: 0, category: '' }),
  })
  .patch('/:id/stock', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ stock: z.number() }),
    response: ProductSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', price: 0, stock: ctx.body.stock, category: '' }),
  })
  .get('/featured', {
    response: z.array(ProductSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), outOfStock: z.number(), avgPrice: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, outOfStock: 0, avgPrice: 0 }),
  })
  .get('/:id/reviews', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.array(ReviewSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/import', {
    body:     z.object({ url: z.string() }),
    response: z.object({ imported: z.number() }),
    handler:  (ctx) => ctx.json({ imported: 0 }),
  })
  .get('/export', {
    query:    z.object({ format: z.enum(['csv', 'json']), categoryId: z.string().optional() }),
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })

// ── Module 5: /api/invoices — 15 routes ───────────────────────────────────────

const invoicesModule = defineModule('/api/invoices')
  .get('/', {
    response: z.array(InvoiceSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: InvoiceSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, orderId: 0, amount: 0, dueDate: '', paid: false }),
  })
  .post('/', {
    body:     z.object({ orderId: z.number(), amount: z.number(), dueDate: z.string() }),
    response: InvoiceSchema,
    handler:  (ctx) => ctx.json({ id: 1, orderId: ctx.body.orderId, amount: ctx.body.amount, dueDate: ctx.body.dueDate, paid: false }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ dueDate: z.string().optional(), amount: z.number().optional() }),
    response: InvoiceSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, orderId: 0, amount: 0, dueDate: '', paid: false }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: InvoiceSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, orderId: 0, amount: 0, dueDate: '', paid: false }),
  })
  .post('/:id/pay', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ method: z.string() }),
    response: InvoiceSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, orderId: 0, amount: 0, dueDate: '', paid: true }),
  })
  .post('/:id/void', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .get('/overdue', {
    response: z.array(InvoiceSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/by-order/:orderId', {
    params:   z.object({ orderId: z.coerce.number() }),
    response: z.array(InvoiceSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), paid: z.number(), overdue: z.number(), revenue: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, paid: 0, overdue: 0, revenue: 0 }),
  })
  .get('/export', {
    query:    z.object({ format: z.enum(['csv', 'pdf']), from: z.string().optional(), to: z.string().optional() }),
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })
  .post('/send-reminder', {
    body:     z.object({ invoiceIds: z.array(z.number()) }),
    response: z.object({ sent: z.number() }),
    handler:  (ctx) => ctx.json({ sent: ctx.body.invoiceIds.length }),
  })
  .get('/search', {
    query:    z.object({ q: z.string(), paid: z.string().optional() }),
    response: z.array(InvoiceSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .patch('/:id/due-date', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ dueDate: z.string() }),
    response: InvoiceSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, orderId: 0, amount: 0, dueDate: ctx.body.dueDate, paid: false }),
  })
  .get('/:id/pdf', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })

// ── Module 6: /api/reviews — 15 routes ────────────────────────────────────────

const reviewsModule = defineModule('/api/reviews')
  .get('/', {
    response: z.array(ReviewSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: ReviewSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, productId: 0, userId: 0, rating: 0, comment: '' }),
  })
  .post('/', {
    body:     z.object({ productId: z.number(), rating: z.number(), comment: z.string() }),
    response: ReviewSchema,
    handler:  (ctx) => ctx.json({ id: 1, productId: ctx.body.productId, userId: 0, rating: ctx.body.rating, comment: ctx.body.comment }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ rating: z.number().optional(), comment: z.string().optional() }),
    response: ReviewSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, productId: 0, userId: 0, rating: 0, comment: '' }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: ReviewSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, productId: 0, userId: 0, rating: 0, comment: '' }),
  })
  .post('/:id/approve', {
    params:   z.object({ id: z.coerce.number() }),
    response: ReviewSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, productId: 0, userId: 0, rating: 0, comment: '' }),
  })
  .post('/:id/reject', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ reason: z.string() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .get('/by-product/:productId', {
    params:   z.object({ productId: z.coerce.number() }),
    response: z.array(ReviewSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/by-user/:userId', {
    params:   z.object({ userId: z.coerce.number() }),
    response: z.array(ReviewSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/pending', {
    response: z.array(ReviewSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), avgRating: z.number(), pending: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, avgRating: 0, pending: 0 }),
  })
  .post('/bulk-approve', {
    body:     z.object({ ids: z.array(z.number()) }),
    response: z.object({ approved: z.number() }),
    handler:  (ctx) => ctx.json({ approved: ctx.body.ids.length }),
  })
  .get('/search', {
    query:    z.object({ q: z.string(), minRating: z.string().optional() }),
    response: z.array(ReviewSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/:id/flag', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ reason: z.string() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .get('/export', {
    query:    z.object({ productId: z.string().optional() }),
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })

// ── Module 7: /api/categories — 15 routes ─────────────────────────────────────

const categoriesModule = defineModule('/api/categories')
  .get('/', {
    response: z.array(CategorySchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: CategorySchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', parentId: null }),
  })
  .post('/', {
    body:     z.object({ name: z.string(), slug: z.string(), parentId: z.number().nullable() }),
    response: CategorySchema,
    handler:  (ctx) => ctx.json({ id: 1, name: ctx.body.name, slug: ctx.body.slug, parentId: ctx.body.parentId }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ name: z.string().optional(), slug: z.string().optional() }),
    response: CategorySchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', parentId: null }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: CategorySchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', parentId: null }),
  })
  .get('/tree', {
    response: z.array(CategorySchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id/children', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.array(CategorySchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id/products', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.array(ProductSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/:id/move', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ parentId: z.number().nullable() }),
    response: CategorySchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', parentId: ctx.body.parentId }),
  })
  .get('/search', {
    query:    z.object({ q: z.string() }),
    response: z.array(CategorySchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), topLevel: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, topLevel: 0 }),
  })
  .post('/reorder', {
    body:     z.object({ ids: z.array(z.number()) }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .get('/by-slug/:slug', {
    params:   z.object({ slug: z.string() }),
    response: CategorySchema,
    handler:  (ctx) => ctx.json({ id: 0, name: '', slug: ctx.params.slug, parentId: null }),
  })
  .patch('/:id/visibility', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ visible: z.boolean() }),
    response: CategorySchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, name: '', slug: '', parentId: null }),
  })
  .get('/export', {
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })

// ── Module 8: /api/notifications — 15 routes ──────────────────────────────────

const notificationsModule = defineModule('/api/notifications')
  .get('/', {
    response: z.array(NotificationSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: NotificationSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, type: '', read: false, createdAt: '' }),
  })
  .post('/', {
    body:     z.object({ userId: z.number(), type: z.string(), message: z.string() }),
    response: NotificationSchema,
    handler:  (ctx) => ctx.json({ id: 1, userId: ctx.body.userId, type: ctx.body.type, read: false, createdAt: '' }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ read: z.boolean() }),
    response: NotificationSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, type: '', read: ctx.body.read, createdAt: '' }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: NotificationSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, userId: 0, type: '', read: false, createdAt: '' }),
  })
  .post('/mark-all-read', {
    body:     z.object({ userId: z.number() }),
    response: z.object({ updated: z.number() }),
    handler:  (ctx) => ctx.json({ updated: 0 }),
  })
  .get('/unread', {
    response: z.array(NotificationSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/by-user/:userId', {
    params:   z.object({ userId: z.coerce.number() }),
    response: z.array(NotificationSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/send-bulk', {
    body:     z.object({ userIds: z.array(z.number()), type: z.string(), message: z.string() }),
    response: z.object({ sent: z.number() }),
    handler:  (ctx) => ctx.json({ sent: ctx.body.userIds.length }),
  })
  .delete('/clear-all', {
    response: z.object({ deleted: z.number() }),
    handler:  (ctx) => ctx.json({ deleted: 0 }),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), unread: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, unread: 0 }),
  })
  .get('/search', {
    query:    z.object({ type: z.string().optional(), read: z.string().optional() }),
    response: z.array(NotificationSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .patch('/bulk-read', {
    body:     z.object({ ids: z.array(z.number()) }),
    response: z.object({ updated: z.number() }),
    handler:  (ctx) => ctx.json({ updated: ctx.body.ids.length }),
  })
  .post('/subscribe', {
    body:     z.object({ userId: z.number(), types: z.array(z.string()) }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .get('/preferences/:userId', {
    params:   z.object({ userId: z.coerce.number() }),
    response: z.object({ types: z.array(z.string()) }),
    handler:  (ctx) => ctx.json({ types: [] }),
  })

// ── Module 9: /api/audit-logs — 15 routes ─────────────────────────────────────

const auditLogsModule = defineModule('/api/audit-logs')
  .get('/', {
    response: z.array(AuditLogSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: AuditLogSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, actor: '', action: '', resource: '', createdAt: '' }),
  })
  .get('/by-actor/:actor', {
    params:   z.object({ actor: z.string() }),
    response: z.array(AuditLogSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/by-resource/:resource', {
    params:   z.object({ resource: z.string() }),
    response: z.array(AuditLogSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/search', {
    query:    z.object({ q: z.string(), from: z.string().optional(), to: z.string().optional() }),
    response: z.array(AuditLogSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/stats', {
    query:    z.object({ from: z.string().optional(), to: z.string().optional() }),
    response: z.object({ total: z.number(), byAction: z.record(z.string(), z.number()) }),
    handler:  (ctx) => ctx.json({ total: 0, byAction: {} }),
  })
  .get('/export', {
    query:    z.object({ format: z.enum(['csv', 'json']), from: z.string().optional(), to: z.string().optional() }),
    response: z.object({ url: z.string() }),
    handler:  (ctx) => ctx.json({ url: '' }),
  })
  .delete('/purge', {
    body:     z.object({ before: z.string() }),
    response: z.object({ deleted: z.number() }),
    handler:  (ctx) => ctx.json({ deleted: 0 }),
  })
  .get('/actions', {
    response: z.array(z.string()),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/resources', {
    response: z.array(z.string()),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/timeline', {
    query:    z.object({ from: z.string(), to: z.string() }),
    response: z.array(AuditLogSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/by-action/:action', {
    params:   z.object({ action: z.string() }),
    response: z.array(AuditLogSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/recent', {
    query:    z.object({ limit: z.string().optional() }),
    response: z.array(AuditLogSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/retain-policy', {
    body:     z.object({ days: z.number() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .get('/summary', {
    query:    z.object({ period: z.enum(['day', 'week', 'month']) }),
    response: z.object({ period: z.string(), events: z.number(), actors: z.number() }),
    handler:  (ctx) => ctx.json({ period: '', events: 0, actors: 0 }),
  })

// ── Module 10: /api/webhooks — 15 routes ──────────────────────────────────────

const webhooksModule = defineModule('/api/webhooks')
  .get('/', {
    response: z.array(WebhookSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: WebhookSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, url: '', events: [], active: true, secret: '' }),
  })
  .post('/', {
    body:     z.object({ url: z.string().url(), events: z.array(z.string()) }),
    response: WebhookSchema,
    handler:  (ctx) => ctx.json({ id: 1, url: ctx.body.url, events: ctx.body.events, active: true, secret: 'whsec_...' }, 201),
  })
  .patch('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ url: z.string().optional(), events: z.array(z.string()).optional() }),
    response: WebhookSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, url: '', events: [], active: true, secret: '' }),
  })
  .delete('/:id', {
    params:   z.object({ id: z.coerce.number() }),
    response: WebhookSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, url: '', events: [], active: false, secret: '' }),
  })
  .post('/:id/activate', {
    params:   z.object({ id: z.coerce.number() }),
    response: WebhookSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, url: '', events: [], active: true, secret: '' }),
  })
  .post('/:id/deactivate', {
    params:   z.object({ id: z.coerce.number() }),
    response: WebhookSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, url: '', events: [], active: false, secret: '' }),
  })
  .post('/:id/test', {
    params:   z.object({ id: z.coerce.number() }),
    body:     z.object({ event: z.string() }),
    response: z.object({ ok: z.boolean(), statusCode: z.number() }),
    handler:  (ctx) => ctx.json({ ok: true, statusCode: 200 }),
  })
  .post('/:id/rotate-secret', {
    params:   z.object({ id: z.coerce.number() }),
    response: WebhookSchema,
    handler:  (ctx) => ctx.json({ id: ctx.params.id, url: '', events: [], active: true, secret: 'whsec_new' }),
  })
  .get('/:id/deliveries', {
    params:   z.object({ id: z.coerce.number() }),
    response: z.array(z.object({ id: z.string(), event: z.string(), status: z.number(), createdAt: z.string() })),
    handler:  (ctx) => ctx.json([]),
  })
  .post('/:id/deliveries/:deliveryId/redeliver', {
    params:   z.object({ id: z.coerce.number(), deliveryId: z.string() }),
    response: z.object({ ok: z.boolean() }),
    handler:  (ctx) => ctx.json({ ok: true }),
  })
  .get('/events', {
    response: z.array(z.string()),
    handler:  (ctx) => ctx.json([]),
  })
  .get('/stats', {
    response: z.object({ total: z.number(), active: z.number(), deliveries: z.number() }),
    handler:  (ctx) => ctx.json({ total: 0, active: 0, deliveries: 0 }),
  })
  .get('/search', {
    query:    z.object({ url: z.string().optional(), active: z.string().optional() }),
    response: z.array(WebhookSchema),
    handler:  (ctx) => ctx.json([]),
  })
  .delete('/bulk-delete', {
    body:     z.object({ ids: z.array(z.number()) }),
    response: z.object({ deleted: z.number() }),
    handler:  (ctx) => ctx.json({ deleted: 0 }),
  })

// ── App — 150 typed routes total ──────────────────────────────────────────────

const app = createApp()
  .register(usersModule.build())
  .register(itemsModule.build())
  .register(ordersModule.build())
  .register(productsModule.build())
  .register(invoicesModule.build())
  .register(reviewsModule.build())
  .register(categoriesModule.build())
  .register(notificationsModule.build())
  .register(auditLogsModule.build())
  .register(webhooksModule.build())

// ── Client — type inference over all 150 routes ───────────────────────────────

const client = createProxyClient(app, 'http://localhost')

// Spot-check: these must type-check without casts across all modules
async function typeCheck() {
  // users
  const users = await client.apiUsers.index()
  if (users.ok) {
    const _name: string  = users.data[0].name
    const _id:   number  = users.data[0].id
  }
  const user = await client.apiUsers.show(1)
  if (user.ok) {
    const _email: string = user.data.email
  }
  const newUser = await client.apiUsers.store({ name: 'Alice', email: 'alice@veln.dev' })
  if (newUser.ok) {
    const _id: number = newUser.data.id        // no cast ✅
  }

  // items
  const items = await client.apiItems.index()
  if (items.ok) {
    const _price: number = items.data[0].price
  }
  const item = await client.apiItems.show(1)
  if (item.ok) {
    const _active: boolean = item.data.active
  }

  // orders
  const order = await client.apiOrders.show(1)
  if (order.ok) {
    const _status: string = order.data.status
    const _total:  number = order.data.total
  }
  const newOrder = await client.apiOrders.store({ userId: 1, items: [{ id: 1, qty: 2 }] })
  if (newOrder.ok) {
    const _id: number = newOrder.data.id       // no cast ✅
  }

  // products
  const products = await client.apiProducts.index()
  if (products.ok) {
    const _slug: string = products.data[0].slug
  }

  // invoices
  const invoice = await client.apiInvoices.show(1)
  if (invoice.ok) {
    const _paid:   boolean = invoice.data.paid
    const _amount: number  = invoice.data.amount
  }

  // reviews
  const reviews = await client.apiReviews.index()
  if (reviews.ok) {
    const _rating: number = reviews.data[0].rating
  }

  // categories
  const category = await client.apiCategories.show(1)
  if (category.ok) {
    const _parentId: number | null = category.data.parentId
  }

  // notifications
  const notifs = await client.apiNotifications.index()
  if (notifs.ok) {
    const _read: boolean = notifs.data[0].read
  }

  // audit-logs
  const logs = await client.apiAuditLogs.index()
  if (logs.ok) {
    const _actor: string = logs.data[0].actor
  }

  // webhooks
  const webhook = await client.apiWebhooks.show(1)
  if (webhook.ok) {
    const _url:    string   = webhook.data.url
    const _events: string[] = webhook.data.events
  }
  const newWebhook = await client.apiWebhooks.store({ url: 'https://example.com', events: ['order.created'] })
  if (newWebhook.ok) {
    const _id: number = newWebhook.data.id     // no cast ✅
  }
}

void typeCheck

