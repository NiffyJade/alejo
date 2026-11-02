/* Generated from ../knowledge/nigerian_hotel_kb.json: the 70 starter answers and the hotel's facts. */
window.FD_KB = [
{
"id": "ci-01",
"c": "check-in",
"q": "What time is check-in?",
"a": "Check-in at [[HOTEL_NAME]] starts from [[CHECKIN_TIME]]. If you arrive earlier, we will store your luggage and check you in as soon as your room is ready.",
"k": [
"CHECKIN_TIME",
"HOTEL_NAME"
],
"s": "starter"
},
{
"id": "ci-02",
"c": "check-in",
"q": "What time is checkout?",
"a": "Checkout is by [[CHECKOUT_TIME]]. If you need more time, let us know and we will check what is possible.",
"k": [
"CHECKOUT_TIME"
],
"s": "starter"
},
{
"id": "ci-03",
"c": "check-in",
"q": "Can I check in early?",
"a": "Early check-in depends on room availability on the day. Message us your arrival time and we will do our best. Early check-in fee, if any: [[EARLY_CHECKIN_FEE]].",
"k": [
"EARLY_CHECKIN_FEE"
],
"s": "starter"
},
{
"id": "ci-04",
"c": "check-in",
"q": "Can I get a late checkout?",
"a": "Late checkout depends on whether the room is needed for another guest. Please ask us before checkout day. Late checkout fee, if any: [[LATE_CHECKOUT_FEE]].",
"k": [
"LATE_CHECKOUT_FEE"
],
"s": "starter"
},
{
"id": "ci-05",
"c": "check-in",
"q": "What do I need to bring to check in?",
"a": "Every guest must present a valid government-issued photo ID at check-in: National ID or NIN slip, international passport, driver's licence or voter's card. Foreign guests should bring their passport with a valid visa or entry stamp. Please also have your booking confirmation ready.",
"k": [],
"s": "starter"
},
{
"id": "ci-06",
"c": "check-in",
"q": "Do I need to be 18 to check in?",
"a": "The guest who checks in and signs the registration must be an adult (18 or older). Children may stay with an adult.",
"k": [],
"s": "starter"
},
{
"id": "ci-07",
"c": "check-in",
"q": "Can someone else check in for me or can I arrive late at night?",
"a": "Late arrivals are welcome, our front desk is staffed through the night. Please tell us your expected arrival time. If someone else is checking in on your behalf, we need their ID and yours, plus your written permission.",
"k": [],
"s": "starter"
},
{
"id": "ci-08",
"c": "check-in",
"q": "Where is the hotel and how do I get there?",
"a": "We are at [[HOTEL_ADDRESS]]. Call the front desk on [[HOTEL_PHONE]] if you need directions. If you are using a ride-hailing app, share the pin we send you and the driver can call us if lost.",
"k": [
"HOTEL_ADDRESS",
"HOTEL_PHONE"
],
"s": "starter"
},
{
"id": "ci-09",
"c": "check-in",
"q": "Can I leave my luggage before check-in or after checkout?",
"a": "Yes. Our front desk can safely store your bags before check-in and after checkout. Please keep valuables and documents with you.",
"k": [],
"s": "starter"
},
{
"id": "bk-01",
"c": "booking",
"q": "How do I change my booking dates?",
"a": "Send us your booking name and the new dates. Changes depend on availability and the rate for the new dates. A team member will confirm your change.",
"k": [],
"s": "starter"
},
{
"id": "bk-02",
"c": "booking",
"q": "What is your cancellation policy?",
"a": "[[CANCELLATION_POLICY]]",
"k": [
"CANCELLATION_POLICY"
],
"s": "starter"
},
{
"id": "bk-03",
"c": "booking",
"q": "How do I pay for my stay?",
"a": "We accept: [[PAYMENT_METHODS]]. For bank transfer, use: [[ACCOUNT_DETAILS]]. Please send your payment receipt to the front desk with your booking name.",
"k": [
"ACCOUNT_DETAILS",
"PAYMENT_METHODS"
],
"s": "starter"
},
{
"id": "bk-04",
"c": "booking",
"q": "Do prices include tax?",
"a": "Please check your booking confirmation. In Nigeria, VAT (currently 7.5%) and sometimes service charges or local hospitality taxes may apply. If anything is unclear, the front desk can explain your bill.",
"k": [],
"s": "starter"
},
{
"id": "bk-05",
"c": "booking",
"q": "Can I get a receipt or invoice for my company?",
"a": "Yes. Tell us the company name and address for the invoice before checkout and we will issue it.",
"k": [],
"s": "starter"
},
{
"id": "bk-06",
"c": "booking",
"q": "Do you take foreign currency or cards?",
"a": "Bills in Nigeria are normally settled in Naira (NGN, ₦). For card, transfer and foreign currency options, see our accepted payments: [[PAYMENT_METHODS]].",
"k": [
"PAYMENT_METHODS"
],
"s": "starter"
},
{
"id": "bk-07",
"c": "booking",
"q": "Is a deposit required?",
"a": "Many hotels hold a refundable caution deposit at check-in. Please ask the front desk for the exact amount for your stay.",
"k": [],
"s": "starter"
},
{
"id": "rm-01",
"c": "rooms",
"q": "What is in my room?",
"a": "Rooms have air conditioning, a TV, a private bathroom with hot water, and a work desk. Details vary by room type. Tell us if anything is missing and we will bring it.",
"k": [],
"s": "starter"
},
{
"id": "rm-02",
"c": "rooms",
"q": "What is the Wi-Fi password?",
"a": "Network: [[WIFI_NAME]]. Password: [[WIFI_PASSWORD]]. If the connection is slow or drops, tell us your room number and we will check it.",
"k": [
"WIFI_NAME",
"WIFI_PASSWORD"
],
"s": "starter"
},
{
"id": "rm-03",
"c": "rooms",
"q": "How do I use the air conditioner?",
"a": "Use the remote in your room. Set it to cool and about 22 to 24°C for comfort. If it does not work, tell the front desk your room number and we will send maintenance.",
"k": [],
"s": "starter"
},
{
"id": "rm-04",
"c": "rooms",
"q": "Can I get extra towels, pillows or toiletries?",
"a": "Yes, free of charge. Tell us your room number and what you need and housekeeping will bring it.",
"k": [],
"s": "starter"
},
{
"id": "rm-05",
"c": "rooms",
"q": "When is the room cleaned?",
"a": "Housekeeping normally cleans rooms during the day. Put the Do Not Disturb sign out if you prefer not to be disturbed, or tell us your preferred time.",
"k": [],
"s": "starter"
},
{
"id": "rm-06",
"c": "rooms",
"q": "Is there a safe in the room?",
"a": "Many rooms have an in-room safe. Check your wardrobe. If yours has none, the front desk can store small valuables.",
"k": [],
"s": "starter"
},
{
"id": "rm-07",
"c": "rooms",
"q": "Can I change my room?",
"a": "Tell us the reason and we will move you if another suitable room is available.",
"k": [],
"s": "starter"
},
{
"id": "rm-08",
"c": "rooms",
"q": "I lost my room key or I am locked out.",
"a": "Go to the front desk with a photo ID and we will issue a new key card or let you in. If you are away from the hotel, call [[HOTEL_PHONE]].",
"k": [
"HOTEL_PHONE"
],
"s": "starter"
},
{
"id": "rm-09",
"c": "rooms",
"q": "Is smoking allowed in the rooms?",
"a": "Smoking is not allowed inside rooms. Please ask the front desk for the designated smoking area. A cleaning fee applies if a room smells of smoke.",
"k": [],
"s": "starter"
},
{
"id": "rm-10",
"c": "rooms",
"q": "How can I reach the front desk from my room?",
"a": "Dial [[FRONT_DESK_EXT]] from your room phone, or message us here.",
"k": [
"FRONT_DESK_EXT"
],
"s": "starter"
},
{
"id": "pw-01",
"c": "power and utilities",
"q": "What happens when there is a power outage (NEPA/light out)?",
"a": "Our generator takes over, usually within moments, so you should have light and Wi-Fi. If you notice a long outage in your room, tell the front desk with your room number.",
"k": [],
"s": "starter"
},
{
"id": "pw-02",
"c": "power and utilities",
"q": "What are the power sockets and voltage in Nigeria?",
"a": "Nigeria uses 230V at 50Hz with Type D and Type G sockets (plugs with three pins). Bring an adapter if your devices use different plugs. The front desk may have some to lend.",
"k": [],
"s": "starter"
},
{
"id": "pw-03",
"c": "power and utilities",
"q": "Is there hot water?",
"a": "Yes, hot water is available in the rooms. If the water is not hot, give the water a minute to warm up or tell us your room number so maintenance can check.",
"k": [],
"s": "starter"
},
{
"id": "pw-04",
"c": "power and utilities",
"q": "Is the tap water safe to drink?",
"a": "We recommend drinking bottled or treated water. We provide drinking water. Ask the front desk if you need more.",
"k": [],
"s": "starter"
},
{
"id": "fd-01",
"c": "food and drink",
"q": "Do you serve breakfast and when?",
"a": "Breakfast is served [[BREAKFAST_HOURS]]. If your booking includes breakfast, it will be on your confirmation.",
"k": [
"BREAKFAST_HOURS"
],
"s": "starter"
},
{
"id": "fd-02",
"c": "food and drink",
"q": "What are the restaurant and bar hours?",
"a": "The restaurant is open [[RESTAURANT_HOURS]]. Room service is available during these times. Ask us for the menu.",
"k": [
"RESTAURANT_HOURS"
],
"s": "starter"
},
{
"id": "fd-03",
"c": "food and drink",
"q": "Do you serve Nigerian food?",
"a": "Yes. Our menu includes local favourites like jollof rice, fried rice, pounded yam with egusi or other soups, pepper soup, suya, grilled fish and plantain. Ask for today's specials.",
"k": [],
"s": "starter"
},
{
"id": "fd-04",
"c": "food and drink",
"q": "Can you cater for dietary needs (vegetarian, halal, allergies)?",
"a": "Please tell us your dietary needs or allergies and we will let the kitchen know. For allergies, speak with the kitchen team directly so nothing is missed.",
"k": [],
"s": "starter"
},
{
"id": "fd-05",
"c": "food and drink",
"q": "Can I order food to my room?",
"a": "Yes, room service is available during restaurant hours. Message us your order and room number. Service charge may apply.",
"k": [],
"s": "starter"
},
{
"id": "fd-06",
"c": "food and drink",
"q": "Can I bring food or drinks from outside?",
"a": "You may eat in your room. Please do not bring outside alcohol to public areas. Ask the front desk about corkage if you plan an event.",
"k": [],
"s": "starter"
},
{
"id": "fd-07",
"c": "food and drink",
"q": "Is there a minibar or bottled water?",
"a": "Bottled water is in your room, and some rooms have a minibar. Anything you use from the minibar is added to your bill.",
"k": [],
"s": "starter"
},
{
"id": "sv-01",
"c": "services",
"q": "Do you offer laundry service?",
"a": "Yes. Hand your items to housekeeping or tell us your room number. Prices: [[LAUNDRY_PRICE_LIST]]. Same-day service may be available if requested early.",
"k": [
"LAUNDRY_PRICE_LIST"
],
"s": "starter"
},
{
"id": "sv-02",
"c": "services",
"q": "Is there a gym, pool or spa?",
"a": "Gym: [[GYM_HOURS]]. Pool: [[POOL_HOURS]]. Ask the front desk about spa and massage options.",
"k": [
"GYM_HOURS",
"POOL_HOURS"
],
"s": "starter"
},
{
"id": "sv-03",
"c": "services",
"q": "Do you have a business centre or meeting rooms?",
"a": "Please tell us your needs, number of people and date and our team will send availability and prices.",
"k": [],
"s": "starter"
},
{
"id": "sv-04",
"c": "services",
"q": "Can you arrange an airport pickup or drop-off?",
"a": "Yes. Send us your flight number, arrival time and number of passengers. Transfer price: [[AIRPORT_TRANSFER_PRICE]]. We recommend pre-booking a trusted driver rather than accepting rides from strangers at the airport.",
"k": [
"AIRPORT_TRANSFER_PRICE"
],
"s": "starter"
},
{
"id": "sv-05",
"c": "services",
"q": "Is there parking?",
"a": "[[PARKING_DETAILS]]",
"k": [
"PARKING_DETAILS"
],
"s": "starter"
},
{
"id": "sv-06",
"c": "services",
"q": "Can I host an event or party in the hotel?",
"a": "Please share the type of event, date, number of guests and budget. Our team will respond with options. Parties in guest rooms are not allowed.",
"k": [],
"s": "starter"
},
{
"id": "sv-07",
"c": "services",
"q": "Do you allow visitors in the rooms?",
"a": "Visitors are welcome in public areas. For room visits, visitors must register at the front desk with a valid ID, and visiting hours may apply. Ask the front desk for details.",
"k": [],
"s": "starter"
},
{
"id": "sv-08",
"c": "services",
"q": "Do you allow pets?",
"a": "Please check with the front desk before bringing a pet. Pets are not allowed in every hotel.",
"k": [],
"s": "starter"
},
{
"id": "sv-09",
"c": "services",
"q": "Do you have family rooms or cots for babies?",
"a": "We can arrange a baby cot or extra bed on request. Tell us your dates and the number of children and their ages.",
"k": [],
"s": "starter"
},
{
"id": "sv-10",
"c": "services",
"q": "Do you have facilities for guests with disabilities?",
"a": "Tell us what you need and we will advise on the best room and any help. Accessibility varies by room.",
"k": [],
"s": "starter"
},
{
"id": "sec-01",
"c": "safety",
"q": "Is the hotel safe and secure?",
"a": "The hotel has security staff on duty around the clock. Keep your room locked, keep valuables in the safe, and do not share your room number or code with strangers.",
"k": [],
"s": "starter"
},
{
"id": "sec-02",
"c": "safety",
"q": "Who do I call in an emergency?",
"a": "Call the front desk immediately on [[FRONT_DESK_EXT]] or our security contact [[SECURITY_CONTACT]]. In Nigeria, the national emergency number is 112.",
"k": [
"FRONT_DESK_EXT",
"SECURITY_CONTACT"
],
"s": "starter"
},
{
"id": "sec-03",
"c": "safety",
"q": "I feel sick or need a doctor.",
"a": "Tell the front desk right away with your room number. The nearest hospital is [[NEAREST_HOSPITAL]]. For a life-threatening emergency call 112. I will also alert our staff.",
"k": [
"NEAREST_HOSPITAL"
],
"s": "starter"
},
{
"id": "sec-04",
"c": "safety",
"q": "Is it safe to walk around outside at night?",
"a": "We advise using a ride-hailing app or a car arranged by the hotel at night rather than walking, and not carrying large amounts of cash or flashing valuables. Ask the front desk about the area.",
"k": [],
"s": "starter"
},
{
"id": "sec-05",
"c": "safety",
"q": "I lost something in the hotel.",
"a": "Please tell us what you lost, where, and your room number. We will check with housekeeping and security. Lost items found after you leave are kept for a limited time.",
"k": [],
"s": "starter"
},
{
"id": "sec-06",
"c": "safety",
"q": "There is a fire or I smell smoke.",
"a": "Leave the room immediately by the nearest stairs, do not use the lift, and tell the front desk or any staff member. For emergencies call 112.",
"k": [],
"s": "starter"
},
{
"id": "loc-01",
"c": "local",
"q": "How do I get around? Are Uber and Bolt available?",
"a": "Ride-hailing apps such as Uber, Bolt and inDrive are used in Lagos, Abuja, Port Harcourt and some other cities. The front desk can also arrange a trusted car and driver.",
"k": [],
"s": "starter"
},
{
"id": "loc-02",
"c": "local",
"q": "What is the traffic like and how early should I leave?",
"a": "Traffic, especially in Lagos, can be heavy at morning and evening rush hours. Leave plenty of extra time, 2 to 3 hours or more for a flight in busy cities. Ask us for a suitable time to leave.",
"k": [],
"s": "starter"
},
{
"id": "loc-03",
"c": "local",
"q": "Where can I get cash or an ATM?",
"a": "The nearest ATM is: [[NEAREST_ATM]]. For safety, use ATMs inside banks or malls in daylight if possible.",
"k": [
"NEAREST_ATM"
],
"s": "starter"
},
{
"id": "loc-04",
"c": "local",
"q": "Can I get a SIM card or data?",
"a": "Nigeria's main networks are MTN, Airtel, Glo and T2 (formerly 9mobile). SIM registration requires ID. Ask us where the nearest shop is, and use hotel Wi-Fi in the meantime.",
"k": [],
"s": "starter"
},
{
"id": "loc-05",
"c": "local",
"q": "What is the weather like?",
"a": "The south has a rainy season roughly April to October and a drier season after. From around December to February the harmattan brings dry, dusty and sometimes hazy air. Northern Nigeria is hotter and drier. Check the forecast before outings.",
"k": [],
"s": "starter"
},
{
"id": "loc-06",
"c": "local",
"q": "What should I wear?",
"a": "Light clothing is comfortable. Carry an umbrella in the rainy season. In northern Nigeria and many public settings, modest dress is respected.",
"k": [],
"s": "starter"
},
{
"id": "loc-07",
"c": "local",
"q": "Should I tip?",
"a": "Tipping is appreciated but not required. Some venues add a service charge. Check your bill.",
"k": [],
"s": "starter"
},
{
"id": "loc-08",
"c": "local",
"q": "What are the main airports in Nigeria?",
"a": "Major international airports include Murtala Muhammed (Lagos), Nnamdi Azikiwe (Abuja), Port Harcourt International and Mallam Aminu Kano International. Tell us your flight and we will advise when to leave.",
"k": [],
"s": "starter"
},
{
"id": "loc-09",
"c": "local",
"q": "Can you recommend restaurants, places to visit or shopping nearby?",
"a": "Tell us what you enjoy, your budget and how far you are willing to go, and the team will suggest options. I will pass this to staff so the advice is accurate and current.",
"k": [],
"s": "starter"
},
{
"id": "co-01",
"c": "checkout",
"q": "How do I check out?",
"a": "You can tap the Check out button in your checkout reminder, or visit the front desk. We will settle your bill, collect keys and take any luggage to storage if needed.",
"k": [],
"s": "starter"
},
{
"id": "co-02",
"c": "checkout",
"q": "How can I see my bill?",
"a": "Ask the front desk for your bill at any time during your stay. You can check it before checkout so there are no surprises.",
"k": [],
"s": "starter"
},
{
"id": "co-03",
"c": "checkout",
"q": "Can I get a ride to the airport after checkout?",
"a": "Yes, we can arrange it. Tell us your flight time and number of passengers. Price: [[AIRPORT_TRANSFER_PRICE]].",
"k": [
"AIRPORT_TRANSFER_PRICE"
],
"s": "starter"
},
{
"id": "co-04",
"c": "checkout",
"q": "How can I leave a review or feedback?",
"a": "We would love your feedback. You can review your stay here: [[REVIEW_LINK]]. If something was not right, please tell us so we can fix it.",
"k": [
"REVIEW_LINK"
],
"s": "starter"
},
{
"id": "cm-01",
"c": "complaints",
"q": "I have a complaint or something is wrong with my room.",
"a": "I am sorry about that. Tell me your room number and what happened and I will alert the team right away so that someone can help you.",
"k": [],
"s": "starter"
},
{
"id": "cm-02",
"c": "complaints",
"q": "The room is noisy.",
"a": "I am sorry. Tell me your room number and I will ask the team to help or offer you a quieter room if one is available.",
"k": [],
"s": "starter"
},
{
"id": "cm-03",
"c": "complaints",
"q": "Something is broken (light, toilet, TV, AC, lock).",
"a": "Sorry about that. Tell me your room number and what is wrong and I will send maintenance as soon as possible.",
"k": [],
"s": "starter"
},
{
"id": "staff-demo-1",
"c": "staff",
"q": "Do you have a helipad?",
"a": "No helipad, Ma. Free parking though.",
"k": [],
"s": "staff"
}
];
window.FD_FACTS = {
"HOTEL_NAME": "BrightSide Hotel",
"HOTEL_ADDRESS": "",
"HOTEL_PHONE": "",
"FRONT_DESK_EXT": "",
"WIFI_NAME": "",
"WIFI_PASSWORD": "",
"CHECKIN_TIME": "2:00 PM",
"CHECKOUT_TIME": "12:00 noon",
"BREAKFAST_HOURS": "from 6:30 AM to 10:30 AM daily",
"RESTAURANT_HOURS": "from 7:00 AM to 10:00 PM daily",
"POOL_HOURS": "7:00 AM to 8:00 PM daily",
"GYM_HOURS": "6:00 AM to 9:00 PM daily",
"LATE_CHECKOUT_FEE": "late checkout is subject to availability, and a part-day or full-night charge may apply. The front desk will confirm the amount before you decide",
"EARLY_CHECKIN_FEE": "none if your room is ready when you arrive. If it is not ready, the front desk will tell you about any charge before you decide",
"AIRPORT_TRANSFER_PRICE": "the price depends on the airport and the type of car. The front desk will confirm the exact price when you book",
"LAUNDRY_PRICE_LIST": "charged per item. Housekeeping will share the price list when you request the service",
"PARKING_DETAILS": "Guest parking is available on site, subject to space. Please give the front desk your vehicle details on arrival.",
"CANCELLATION_POLICY": "Cancellation and change terms depend on the rate you booked. Please check your booking confirmation, or ask the front desk.",
"PAYMENT_METHODS": "cash (Naira), bank transfer and card payments (POS)",
"ACCOUNT_DETAILS": "",
"SECURITY_CONTACT": "",
"NEAREST_HOSPITAL": "",
"NEAREST_ATM": "the front desk can point you to the nearest ATM and the safest way to get there",
"REVIEW_LINK": ""
};
