# Alejo product strategy

Written 2026-11-10 from an outside review of how Alejo should stand apart from all-in-one hotel systems (StayFlow OS was the comparison). This file keeps the advice honest against what is actually built, so nothing on the website or in a sales call promises more than the product does.

## Position

**Alejo: every guest heard, every question answered.** The AI front desk for Nigerian hotels. AI answers; people deliver the hospitality.

We do not compete on feature count or try to be a property management system (PMS). We compete on understanding guests and making sure nothing a guest asks is dropped.

| All-in-one hotel systems | Alejo |
| --- | --- |
| Manage reservations | Turn conversations into reservations |
| Manage guest communication | Understand what the guest is asking, in Pidgin or English |
| Show reports | Say what to fix next |
| Automate processes | Make sure a person picks up whatever the AI should not answer |

Three words for the product: **understand** the guest, **coordinate** the right person, **improve** the service over time.

## What exists today, and what does not

| Idea from the review | State | Where |
| --- | --- | --- |
| Guest journey (book, remind, check in, check out, thank) | Built | n8n scheduler, Telegram bot, `directives`/`execution/build_n8n_workflows.py` |
| Voice concierge, Nigerian English | Built, accuracy on real calls unmeasured, no phone number attached | Vapi assistant "Hotel Receptionist (Nigeria test)" |
| Pidgin replies | Built for Telegram Q&A and booking; not for reminders, menu texts or voice | `telegram_booking_js/lang.js`, bot prompt |
| Yoruba | **Not built.** Yoruba-accented English only. Never advertise Yoruba. | |
| Answers only from hotel facts, escalate when unsure | Built | `knowledge_entries`, `hotel_settings`, escalations |
| Staff reply goes to guest, saved as a fact | Built | `staff-reply` edge function, dashboard Inbox |
| Resolution view for managers | **Started 2026-11-10**: Today screen shows questions settled, handled alone, median staff fix time, rule-based "Alejo suggests" | `website/app/app.js` `renderOverview` |
| Service recovery (ticket, notify, follow up, escalate) | **Telegram part live since 2026-11-10** (SQL 013, bot, scheduler, dashboard). **Phone tagging and Take it (sql/014) live too.** Requests, complaints and emergencies are tagged (kind + category), staff are re-alerted every 30 min (10 for emergencies, 3 times), the guest is asked once whether it is sorted, and Today shows a "Fixed on time" score. Phone calls become tracked items closed with Resolve after the call-back; staff can Take it / Release / Take over. A guest chasing an open item ("any update?") nudges the existing item instead of creating a second one (live, sql/016; not yet exercised with a real Telegram message). Missing: items assigned to a named person by a manager | `sql/013`, `execution/telegram_booking_js/`, `build_n8n_workflows.py`, `website/app/` |
| Proactive guest intelligence | **Late-arrival check live 2026-11-10 (first piece).** Guests due today who have not checked in by 18:00 and are on Telegram get one message asking if they are running late; a reply with a time reaches staff as a normal alert. Not yet fired for real (window is 18:00-22:59 Lagos). Still missing: repeat-question nudge, offers based on what a guest keeps asking | `sql/015`, scheduler branch F, bot prompt |
| Guest memory across stays | **Not built.** Needs consent, retention limits, delete-on-request | later, privacy first |
| Staff copilot (who arrives today, what is pending, shift handover, free questions) | **Built 2026-11-10 (first version).** "Ask Alejo" card on Today: three quick answers computed in the browser from the data on screen, free questions answered by the `staff-copilot` edge function from a live snapshot (arrivals, open items, last 7 days, held-back facts). It says plainly that room cleaning, rotas and payments are not tracked, and cannot compare with earlier weeks. Authenticated path not yet exercised with a real staff login | `supabase/functions/staff-copilot`, `execution/test_copilot.js`, `website/app/app.js` |
| Manage bookings from the dashboard (new walk-in / phone / online booking, cancel, check in and out, room number, payments, block rooms) | **Built 2026-11-23.** Database part live (`sql/017`): staff-only functions that use the same lock and availability rule as the Telegram and phone bookings, so no channel can double-book another. Availability is now counted per night (it used to refuse stays that merely touched a busy date) and respects blocked rooms. Screens: "New booking", a panel per stay, "Blocked rooms" in `website/app/manage.js` (ship with the next dashboard deploy). Not yet: changing a booking's dates or room type, telling the guest on Telegram when staff cancel, payment gateway / proof-of-payment checking | `sql/017_manage_bookings.sql`, `execution/test_manage_bookings.sql`, `website/app/manage.js` |
| Enquiry and conversion report, and follow-up of unfinished bookings | **Built 2026-11-23** (`sql/018`, bot + scheduler live, Enquiries page ships with the next dashboard deploy). Every Telegram message is now logged with its chat and intent, including from people who have not booked (before this the bot only kept known guests' messages, so earlier history cannot be recovered). The Enquiries page counts conversations, who asked about rooms, who booked, who the AI handled alone vs needed a person (and the median staff reply time), after-hours enquiries, who is still thinking, and how follow-ups did. Follow-up (scheduler branch G): once, 90 min to 5 h after someone gave dates and a room and went quiet, 08:00-20:59 Lagos, with Continue / No thanks buttons; promises nothing about the room; on by default, switch `FOLLOWUP_ENABLED` on the Enquiries page. Not yet: phone calls are not counted as enquiries, no follow-up for people who never gave dates, English/Pidgin only, no way to message a "still thinking" person from the dashboard | `sql/018_enquiries.sql`, `execution/test_enquiry_report.sql`, `execution/telegram_booking_js/followup_compose.js`, `website/app/enquiries.js` |
| Post-checkout ratings (1-5) with low scores becoming complaints, and a weekly summary | **Built 2026-11-23** (`sql/019`, bot + scheduler live, Ratings page ships with the next dashboard deploy). About 30 min after checkout the thank-you now carries five rating buttons (Telegram guests only; English only). A score of 3 or less opens ONE complaint item for the stay (kind complaint, category other), alerts the staff group, and then follows the normal service-recovery rules (re-alert every 30 min, "is it sorted?" to the guest, Inbox reply). Guests can change their score for 14 days. Monday 09:00 Lagos the staff group gets last week's ratings (nothing is sent in a week with no ratings). The public review link goes to EVERY guest (review gating is against Google's policy). Ratings page: average and trend, response rate, spread, by room type, low scores with status. Not yet: Pidgin, free-text comment capture beyond the Inbox thread, guests who booked by phone and are not on Telegram are never asked | `sql/019_ratings.sql`, `execution/test_ratings.sql`, `execution/telegram_booking_js/{rating_reply,thanks_compose,digest_compose}.js`, `website/app/ratings.js` |
| AI insights ("why more complaints?") | Not built. Current suggestions are plain rules, not AI | later |
| Automation marketplace | Not built | far later |
| Integrate with the hotel's existing PMS | Not built. Alejo keeps its own bookings | decide after demos show demand |

## Rules for copy

1. Say only what is built. The website and demos use the "Built" rows.
2. "Next" items may appear only as plainly labelled plans (as WhatsApp already is).
3. Call rule-based output "suggestions", not "AI insights", until a model is doing the analysis.
4. Money and room availability are never decided by the model (already the rule for bookings).

## Build order

1. **Service recovery** (highest value, closest to what exists). Classify a guest message as question, request or complaint. Requests and complaints become a tracked item with a category (maintenance, housekeeping, other), a status, an owner, a timestamp and a re-alert when it sits too long. Tell the guest when it is done. Dashboard: open items, oldest first, and a resolution time per category. Needs a new table (for example `service_requests`) and a workflow change; ask before applying SQL to the live database.
2. **Resolution score.** Once items have timestamps: share resolved within target, median time, by category. Today already reports the question version of this.
3. **Proactive guest follow-up.** Follow up on an open complaint after N minutes; late-arrival instructions; repeat-question offers.
4. **Voice.** Attach a phone number (blocked: no free number), measure accuracy on real Nigerian audio, then Pidgin on calls.
5. **Staff copilot.** Ask the dashboard "who arrives today", "what is pending", and shift handover summaries.
6. **Guest memory.** Only with explicit consent, a retention limit and a delete button.
7. **PMS connection.** Pick one system after hotels in demos name it.

Not now: accounting, full PMS replacement, marketplace.

## Dashboard direction

The first screen answers "what needs me, and what has Alejo already handled?" Today now leads with: guests who need you, questions settled (%), questions Alejo handled alone, and arrivals who cannot be reached on Telegram, followed by a short "Alejo suggests" list. Keep it calm: one idea per block, no extra widgets.

## Monthly check

Once a month, read the public pages of two or three hotel-software competitors (changelogs, pricing, new features). Write down anything a Lagos hotel manager would care about. Do not copy layout, wording or navigation; only note gaps in what guests and staff can do.

## Open questions for the owner

- Which existing hotel systems do target hotels use? That decides whether a PMS connection is worth building.
- Real prices for service requests: is it a per-hotel plan feature or part of the Hotel plan?
- Does the hotel want guests told "your request is done" automatically, or only after a staff member confirms?
