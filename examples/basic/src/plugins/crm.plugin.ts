/**
 * crmPlugin — full plugin showcase: .modules() + .permission() + .nav()
 *
 * Demonstrates the complete plugin API introduced in Specs 01–03:
 *
 *   .modules([...])    → contributes routes to the app automatically
 *   .permission('...')  → gates all plugin routes (and nav) behind a permission
 *   .nav([...])         → contributes nav items to GET /nav, filtered by permission
 *
 * Usage:
 *   app.plugin(crmPlugin)
 *
 * Routes registered automatically:
 *   GET /crm/contacts   → requires 'crm:read'  permission
 *   GET /crm/contacts/:id
 *   POST /crm/contacts  → requires 'crm:write' permission (TODO: split plugins)
 *
 * Nav (visible only when user has 'crm:read'):
 *   Contacts  /crm/contacts  icon: users   order: 20
 *
 * Permission check order (from Spec 02):
 *   route match → permission check → onRequest → plugins → guards → handler
 *
 * To grant a user 'crm:read', ensure your AuthAdapter returns it in user.permissions.
 * With betterAuthAdapter() and Better Auth roles, set user.role = 'crm' and the
 * adapter maps it to 'role:crm' — so use .permission('role:crm') in that case.
 */

import { definePlugin, defineModule } from 'oakbun'

// ── Module — routes contributed by this plugin ────────────────────────────────

const crmModule = defineModule('/crm')
  .meta({ tag: 'CRM', description: 'Customer relationship management (contributed by crmPlugin)' })
  .route({
    method:  'GET',
    path:    '/contacts',
    summary: 'List contacts',
    handler: (ctx) => ctx.json({
      contacts: [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob',   email: 'bob@example.com' },
      ],
    }),
  })
  .route({
    method:  'GET',
    path:    '/contacts/:id',
    summary: 'Get contact by id',
    handler: (ctx) => ctx.json({ id: Number(ctx.params['id']), name: 'Alice' }),
  })
  .build()

// ── Plugin definition ─────────────────────────────────────────────────────────

export const crmPlugin = definePlugin<object>('crm')
  // Routes registered automatically — no separate app.register() needed
  .modules([crmModule])

  // Gates all plugin routes AND nav entries behind this permission.
  // No permission → 401 Unauthorized (no user) or 403 Forbidden (wrong permissions).
  .permission('crm:read')

  // Nav entries — visible in GET /nav only when user has 'crm:read'
  .nav([
    {
      label:  'Contacts',
      route:  '/crm/contacts',
      icon:   'users',
      order:  20,
    },
  ])

  // Context extension — adds ctx.crmVersion for handlers if needed
  .extend(() => ({
    crmVersion: '1.0',
  }))
