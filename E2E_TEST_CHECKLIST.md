# Alejo end-to-end test checklist

Run everything from the project folder (`AI Receptionist`). Tick each box as you go. If a step fails, write the step number and what you saw in the Notes line, then run `python execution/e2e_helper.py status` and send both to Claude.

**What you need:** a phone with Telegram, a way to see the staff group (Telegram on your computer is easiest), and a microphone for step 3 (or use the shortcut there).
**Links:** site https://alejo-nine.vercel.app · dashboard https://alejo-nine.vercel.app/app · bot `@brightside_Staff_bot`
**Test data rule:** every test guest must be named "Test <something>" (for example "Test Tolu"). Cleanup only deletes guests whose names start with "Test".
**Timing:** the scheduler runs every 15 minutes in Lagos time. Check-in reminders go out from 10:00 for stays that start tomorrow. Checkout reminders go out from 08:00 for stays that end today. The thank-you goes out 30 minutes after checkout.

---

## 0. Before you start (5 minutes)

- [ ] Run `python execution/e2e_helper.py check`. It should end with **READY**.
- [ ] Create your dashboard login (use your own email and name). It prints a one-time password, so save it:
  `python execution/supabase_admin.py staff-user you@email.com "Your Name" owner`
- [ ] Run `python execution/supabase_admin.py disable-signup` so only listed staff can ever sign in.
- [ ] Telegram is open on your phone, and you can see the staff group.

Notes:

## 1. Website to lead

- [ ] Open the site and ask the chat "What time is checkout?". Expect: checkout is by 12:00 noon.
- [ ] Ask "Do you have a helipad?". Expect: it says it is checking, and a staff box appears.
- [ ] In the staff box, type `#kb No helipad, Ma. Free parking though.` and send. Expect: the guest sees the update and a "Saved as an answer" note.
- [ ] Ask "Do you have a helipad?" again. Expect: it answers straight away with the saved reply.
- [ ] Submit the demo form: hotel "Test Hotel", your email, any room option. Expect: "Thank you" on the page, and a "New Alejo demo request" message in the staff group within seconds.

Notes:

## 2. Dashboard sign-in

- [ ] Open `/app/login` and sign in with the email and password from step 0.
- [ ] Expect: the top bar says **Live data** and the sidebar shows your name.
- [ ] Today shows 0 need-you and an empty timeline (there is no booking yet, so that is correct).
- [ ] Facts shows 70 answers.

Notes:

## 3. Book by voice

- [ ] In dashboard.vapi.ai open the assistant **Hotel Receptionist (Nigeria test)** and press Talk.
- [ ] Say: "I want a Deluxe room from tomorrow for two nights. My name is **Test Tolu**." Give your own Telegram phone number when asked (browser calls have no caller number).
- [ ] Expect: it reads the name, room type and dates back and waits for your yes. Then it says "Booked", gives a reference, and explains the Telegram step.
- [ ] Reload the dashboard. Expect: Today shows 1 arriving, and the timeline has a dashed bar "Not on Telegram".
- [ ] No microphone? Skip the call and run `python execution/e2e_helper.py book Tolu --in tomorrow`. It prints the Telegram link for step 4.

Notes:

## 4. Guest connects Telegram

- [ ] On your phone open the bot, press **Start**, and share your contact (or open the link from the helper).
- [ ] Expect: the bot says your chat is linked to your booking.
- [ ] Run `python execution/e2e_helper.py status`. Expect: "on Telegram: yes".

Notes:

## 5. Guest questions

- [ ] Send "abeg, wetin be the wifi password?". Expect: the password from your facts.
- [ ] Send "Can I bring my goat?". Expect: "I'm checking with our team", and an alert in the staff group.
- [ ] In the group, reply to that alert message starting with `#kb`, for example `#kb Sorry, no animals. Service dogs only.` Expect: the guest receives the update, and the group confirms it was saved.
- [ ] Send the goat question again. Expect: it now answers straight away.
- [ ] Send "I need a doctor". Expect: it gives 112, and the staff group is alerted at once.

Notes:

## 6. Reply from the dashboard

- [ ] As the guest, ask a new unknown question, for example "Do you have a helipad?".
- [ ] In the dashboard open Today. Expect: 1 need-you, with the guest listed.
- [ ] Click **Reply**, type an answer, leave "Save my answer to Facts" ticked, and press **Send reply**.
- [ ] Expect: the guest gets "Update from our team", the staff group shows who replied from the dashboard, and the question leaves "Needs you".
- [ ] Open Facts. Expect: the new answer appears under "From your staff".

Notes:

## 6b. The dashboard updates by itself (no refresh)

Keep the dashboard open on Today in one window and Telegram open in another.

- [ ] The top bar says **Live, updated HH:MM** with a green dot (an amber dot and "Reconnecting…" means it lost the connection and is catching up).
- [ ] As the guest, send a question the AI can't answer. Within about 3 seconds, with no refresh: **Need you** goes up, a toast says "A guest needs you: ...", and the browser tab title shows **(1)**.
- [ ] Open the Inbox and start typing a reply, but don't send. As the guest, send another message. Expect: the new message appears in the open chat, and your half-written reply is still there with the cursor in place.
- [ ] Answer the question from the staff group in Telegram. Expect: the queue empties by itself within a few seconds.

Notes:

## 6c. "Typing..." in Telegram

- [ ] As the guest, send "wetin be the wifi password". Expect: you see **typing...** under the bot's name within a second, then the answer arrives.
- [ ] Ask something the AI can't answer. Expect: typing, then "I'm checking with our team".
- [ ] In the dashboard Inbox, open that question and start typing a reply. Expect: the guest's Telegram shows **typing...** while you type (it repeats about every 4 seconds), then your reply arrives.
- [ ] Known limit: Telegram does not tell bots when someone types in a group, so replying from the staff group in Telegram cannot show typing. Reply from the dashboard to get it.

Notes:

## 6d. Manage Facts from the dashboard

- [ ] Open **Facts**. Click **Add a fact**, write a question and an answer, and press **Add**. Expect: it appears once in the list under "From your staff".
- [ ] On that row click **Delete**. Expect: the button turns into "Delete? Yes No". Press **Yes**. Expect: the row disappears and stays gone after a refresh.
- [ ] Scroll to **Hotel details**. Click **Edit** on one (for example the Wi-Fi password), change it, press **Save**, then ask the bot for it. Expect: the new value.
- [ ] Click **Clear** on a detail. Expect: it asks first, tells you how many answers will be held back, and then those answers go to "Held back" until you fill it in again. Fill it back in afterwards.

Notes:

## 7. Check-in reminder

The booking starts tomorrow, so the reminder arrives within 15 minutes of the next scheduler run.

- [ ] Telegram shows "Your stay starts tomorrow" with a **Check in** button.
- [ ] Tap **Check in**. Expect: a private 6-digit stay code.
- [ ] In the dashboard open Bookings. Expect: the journey shows "Checked in". On Today the timeline bar is solid blue.

Notes:

## 8. Checkout and thank-you

- [ ] Run `python execution/e2e_helper.py checkout-today`.
- [ ] Within 15 minutes Telegram shows a checkout message with a **Check out** button. Tap it.
- [ ] Run `python execution/e2e_helper.py age-checkout`.
- [ ] Within 15 minutes Telegram shows a thank-you with the review link.
- [ ] Run `python execution/e2e_helper.py status` any time to see which steps have fired.

Notes:

## 9. Clean up

- [ ] Run `python execution/e2e_helper.py cleanup`.
- [ ] Run `python execution/e2e_helper.py status`. Expect: "No test bookings yet".
- [ ] Open Facts. Expect: the answers you saved in steps 5 and 6 are gone (cleanup removes them). The step 1 `#kb` answer lived only in the website chat and vanished when you reloaded the page.

Notes:

---

## Not covered yet

- A real phone number answering calls (needs a Nigerian number).
- WhatsApp.
- Sample content still to replace: prices, hotel facts (BrightSide Hotel test values), the demo email `demo@alejo.example`.

## After testing

- [ ] Revoke the tokens you pasted into chat: Cloudflare, Supabase access token, n8n key, Telegram bot token (and re-run the helper afterwards if you change them in `.env`).
