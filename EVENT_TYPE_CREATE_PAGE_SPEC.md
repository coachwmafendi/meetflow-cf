# Event Type Create Page — Design Spec

## 1. Goal

Move **"New event type"** from a modal dialog on `/dashboard/event-types` to a dedicated full page at `/dashboard/event-types/new`. The dedicated page gives the form enough room for the upcoming **cover image** field and makes the UX consistent with the existing `/dashboard/event-types/:id` edit page.

## 2. Why a full page beats the modal

| Concern        | Current modal                     | Dedicated page                         |
| -------------- | --------------------------------- | -------------------------------------- |
| Form length    | Cramped when group/dates are open | Natural scroll, clear sections         |
| File upload    | No room for drag-and-drop/preview | Image preview + remove action          |
| Mobile UX      | Dialog + keyboard overlap         | Standard page, keyboard friendly       |
| Deep-linking   | Cannot be shared/bookmarked       | `/dashboard/event-types/new` has a URL |
| Consistency    | Uses Alpine + API                 | Matches edit page server-rendered form |
| Error recovery | Re-rendering wipes state          | Server re-render preserves input       |

## 3. Routes

Add one route, keep the existing POST destination.

| Method | Path                         | Purpose                                     |
| ------ | ---------------------------- | ------------------------------------------- |
| `GET`  | `/dashboard/event-types/new` | Render the creation form                    |
| `POST` | `/dashboard/event-types`     | Create event type (extend existing handler) |

The existing `POST /dashboard/event-types` is updated to:

- Accept `multipart/form-data` (so it can receive the image file).
- Support all the same fields the modal currently supports (group seats, schedule mode, specific dates).
- Handle image upload, validation, and storage.

## 4. Database change

Add an `image_key` column to `event_types`, mirroring the pattern used for `users.avatar_key`.

**Migration `migrations/0013_event_type_image.sql`**

```sql
ALTER TABLE event_types ADD COLUMN image_key TEXT;
```

Update `EventTypeRow` in `src/types.ts`:

```ts
export interface EventTypeRow {
  // ... existing fields ...
  /** R2 object key for the event cover image, or null. */
  image_key: string | null;
  // ...
}
```

Update database helpers in `src/db/eventTypes.ts` to include `image_key` in `INSERT` and `UPDATE`.

## 5. Image storage

### Recommended: dedicated R2 bucket

Add a second bucket in `wrangler.jsonc` so event images are separated from avatars:

```jsonc
"r2_buckets": [
  { "binding": "AVATARS", "bucket_name": "meetflow-avatars" },
  { "binding": "EVENT_IMAGES", "bucket_name": "meetflow-event-images" }
]
```

Run `npx wrangler r2 bucket create meetflow-event-images` once.

### Alternative: reuse AVATARS bucket

If adding a bucket is too much overhead, reuse `AVATARS` but store event images under a distinct prefix:

```ts
return `event-images/${userId}/${eventTypeId}/${crypto.randomUUID()}.${ext}`;
```

This is simpler but slightly messy because the bucket is named `meetflow-avatars`. Prefer the dedicated bucket.

## 6. Image upload requirements

| Rule                | Value                           | Reason                                                       |
| ------------------- | ------------------------------- | ------------------------------------------------------------ |
| Max file size       | 5 MB                            | Cover images can be larger than avatars but still bounded    |
| Allowed formats     | PNG, JPEG, WebP, GIF            | Same sniffed-byte validation as avatars; no SVG for security |
| Min dimensions      | 400×225 (16:9) or 400×300 (4:3) | Prevent tiny blurry covers                                   |
| Aspect ratio        | 16:9 recommended, 4:3 accepted  | Fits nicely at the top of a booking card                     |
| Server-side resize  | Optional                        | Use Cloudflare Images or resize via wasm if needed later     |
| Deletion on replace | Yes                             | Delete old key from R2 when a new image replaces it          |

Reuse `src/lib/image.ts` helpers (`sniffImageFormat`, `ImageError`) and add an event-image validator:

```ts
// src/lib/image.ts additions
export const MAX_EVENT_IMAGE_BYTES = 5 * 1024 * 1024;

export function eventImageKey(userId: number, eventTypeId: number, format: ImageFormat): string {
  return `event-images/${userId}/${eventTypeId}/${crypto.randomUUID()}.${extensionFor(format)}`;
}

export async function validateEventImage(file: unknown) {
  // same shape as validateAvatar, but 5 MB and optional dimension checks
}
```

## 7. New page layout

URL: `/dashboard/event-types/new`

Page structure (server-rendered, same style as the edit page):

```
[Back to event types]

 eyebrow: Event type
 title: New event type
 subtitle: Create a bookable meeting or ticketed session

[Form card]                    [Sidebar card: Preview]
- Name                         Shows how the public booking
- URL slug                     page/card will look with the
- Cover image (file + preview) uploaded image + name +
- Description (textarea)       description
- Booking style (private/group)
- Seats (if group)
- Schedule mode (weekly/dates)
- Date rows (if dates)
- Duration (if weekly)
- Buffer after meeting (if weekly)
- Location type + value

[Create event type button]
```

### Field details

| Field                                 | Type      | Required    | Notes                                                            |
| ------------------------------------- | --------- | ----------- | ---------------------------------------------------------------- |
| `name`                                | text      | yes         | max 100                                                          |
| `slug`                                | text      | yes         | lowercase, dashes, digits; max 60                                |
| `image`                               | file      | no          | preview shown immediately via `URL.createObjectURL` (vanilla JS) |
| `description`                         | textarea  | no          | plain text; rendered as paragraphs on public page                |
| `seats_total`                         | number    | yes         | default 1; >=2 enables group mode                                |
| `schedule_mode`                       | select    | yes         | `weekly` or `dates`                                              |
| `duration_minutes`                    | number    | yes         | 5-480, step 5; hidden when schedule_mode=dates                   |
| `buffer_minutes`                      | number    | yes         | 0-120, step 5; hidden when schedule_mode=dates                   |
| `location_type`                       | select    | yes         | none/google_meet/zoom/in_person/phone                            |
| `location_value`                      | text      | conditional | required when location_type !== none                             |
| `ed_date_*`, `ed_start_*`, `ed_end_*` | date/time | conditional | required when schedule_mode=dates                                |

### JavaScript required on the page

- **Image preview**: on file input change, show `URL.createObjectURL` preview and a remove button.
- **Schedule mode toggle**: show/hide weekly fields vs. date rows (copy the logic from edit page).
- **Dynamic date rows**: add/remove specific-date rows (copy from edit page).
- **Group mode**: reveal seats field when seats_total >= 2.

Use plain vanilla JS, not Alpine, to stay consistent with the edit page and to keep the page lightweight.

## 8. Form submission flow

```
POST /dashboard/event-types
multipart/form-data
```

Handler responsibilities (`src/routes/pages.ts`):

1. Parse multipart body (`c.req.parseBody()`).
2. Validate `name`, `slug`, `duration_minutes`, `buffer_minutes`, `seats_total`, `location_type`, `location_value`, schedule mode + dates.
3. If validation fails, re-render the page with the submitted values and an error alert.
4. Insert row without image key first (need the `eventType.id` for the R2 key).
5. If an image was uploaded:
   - `validateEventImage(file)`
   - `key = eventImageKey(user.id, eventType.id, format)`
   - `c.env.EVENT_IMAGES.put(key, bytes, { httpMetadata: { contentType: format } })`
   - Update `event_types.image_key = key`
6. If schedule_mode=dates, insert `event_dates` rows.
7. Redirect to `/dashboard/event-types?toast=Event+type+created`.

### Validation error re-render

If validation fails before insertion, show the form again with:

- Filled-in text values
- Selected location/schedule/group options restored
- An inline alert at the top of the form
- File input is empty (browsers cannot pre-fill files), but show a message: "Please re-select the image."

If insertion fails (e.g. duplicate slug), re-render with the duplicate slug error.

## 9. Public booking page updates

Files to update:

- `src/views/publicBooking.ts`
- `src/routes/api.public.ts` (if the public API exposes event types)

Display rules:

- If `eventType.image_key` exists, show a cover image at the top of the booking card.
- Always show `eventType.description` if present (already shown in some places; ensure it is visible).
- Fallback to the existing monogram/initials card if no image.

Image serving:

- Add `GET /event-images/:userId/:eventTypeId/:file` to serve from `EVENT_IMAGES` with proper `Content-Type` and caching headers, mirroring `/avatars/:userId/:file`.

## 10. Event type list page changes

In `src/views/dashboard.ts::eventTypesPage`:

- Remove the `<dialog id="create-event-type">` modal and its `EMBED_SCRIPT` Alpine form.
- Change the "New event type" buttons to links to `/dashboard/event-types/new`.
- Keep embed dialogs for **existing** event types (they are unrelated).
- Optionally show a small thumbnail next to each event type card if `image_key` is set.

## 11. Edit page changes

In `src/views/dashboard.ts::eventTypeEditPage`:

- Add the same **Cover image** field to the edit form.
- Add an image preview.
- Add a "Remove image" checkbox/button that deletes the R2 object and clears `image_key`.
- If a new image is uploaded on edit, delete the old `image_key` from R2 after the new one is stored.

## 12. Deletion / deactivation

When an event type is deleted (or deactivated because it has bookings):

- If `image_key` exists, delete the R2 object in the background with `c.executionCtx.waitUntil(...)`.

## 13. Migration & deployment checklist

- [ ] Create migration `migrations/0013_event_type_image.sql`
- [ ] Run `npm run db:migrate:local` and `npm run db:migrate` as needed
- [ ] Create R2 bucket `meetflow-event-images` (or decide to reuse AVATARS)
- [ ] Update `wrangler.jsonc` with new `EVENT_IMAGES` binding
- [ ] Update `src/types.ts`
- [ ] Update `src/db/eventTypes.ts` SQL and interfaces
- [ ] Update `src/lib/image.ts` with event image helpers
- [ ] Add R2 image serving route
- [ ] Add `GET /dashboard/event-types/new` route
- [ ] Update `POST /dashboard/event-types` route
- [ ] Create new view `eventTypeCreatePage` in `src/views/dashboard.ts`
- [ ] Update `eventTypesPage` to link to the new page and remove modal
- [ ] Update `eventTypeEditPage` with image support
- [ ] Update `src/views/publicBooking.ts` to render cover image
- [ ] Update `worker-configuration.d.ts` by running `npx wrangler types`
- [ ] Add/adjust tests in `test/`
- [ ] Deploy

## 14. Open questions

1. **Rich text for description?** Current description is plain text. Should it support Markdown or basic HTML? Recommendation: keep plain text for now; Markdown can be added later without a schema change.
2. **Image cropping?** Do users crop/scale before upload, or do we accept any aspect ratio and crop server-side? Recommendation: client-side preview only; server stores original and CSS crops with `object-cover`.
3. **Group event cover image on ticket page?** Should tickets page also show the event image? Nice-to-have, not required for MVP.
4. **Default image?** If no image is uploaded, should the public card show a colored pattern/gradient assigned per event? Nice-to-have.

## 15. Suggested field additions beyond image + description

For completeness, the following fields fit naturally on the new full page without adding much scope:

| Field                      | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| **Confirmation message**   | Custom message shown after a guest books                   |
| **Minimum notice**         | How many hours/days before a slot can be booked            |
| **Maximum future booking** | How far ahead guests can book                              |
| **Custom accent color**    | Brand color for the public booking card                    |
| **Visibility**             | Public / link-only (already partly handled by `is_active`) |

Keep the first version focused on image + description, then add these one at a time.
