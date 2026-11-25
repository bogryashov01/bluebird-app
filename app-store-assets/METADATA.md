# Bluebird — App Store Connect draft (1.0.0)

Draft copy only. Nothing has been entered in App Store Connect. Every item marked VERIFY needs an owner to confirm it.

## Listing
- **Name:** Bluebird Jets (VERIFY that the name is available; the app's display name is "Bluebird")
- **Subtitle (30 chars):** Private flights, simplified
- **Promotional text:** Discover available private flights, join the queue for the ones you want, and manage your Bluebird membership in one app.
- **Description:**
  Bluebird is the members' app for Bluebird Jets.
  • Discover available private flights on a live map and browse routes, aircraft and departure times.
  • Join the flight queue for the flights you want and see your place in line.
  • Set your preferred airports so the right flights find you.
  • Manage your Bluebird membership and profile.
  • Connect and message with fellow members. (Leave this line out until backend #1838 is live.)
  A Bluebird membership is required for some features.
- **Keywords (100 chars):** private jet,empty leg,charter,private aviation,jet card,flights,membership,aircraft,travel
- **Category:** Travel (secondary: Lifestyle)

## URLs (the site returns 200 for every path, so open each one in a browser)
- **Support:** https://bluebirdjets.com/contact (VERIFY that the page has contact details; the app also lists hello@bluebirdjets.com)
- **Privacy policy:** https://bluebirdjets.com/privacy (the page title reads "Privacy Policy — Bluebird"; VERIFY the content)
- **Marketing:** https://bluebirdjets.com

## Screenshots
- **Required:** iPhone with Dynamic Island, medium display, 1206 × 2622 px. Output: `out/1206x2622/`.
- **Large display:** iPhone with Dynamic Island, 1320 × 2868 px. Provide it, or Face ID large screenshots become required. Output: `out/1320x2868/`.
- **iPhone Duo:** 1398 × 2034 and 2007 × 2853 px. Only required from April 2027, and only for builds made with the iOS 27.1 SDK or later. Build 22 uses Xcode 26.6, so skip these for now.
- **Product page header:** optional, iOS 27 or later only, 16:9 at 5244 × 2950 or 21:9 at 3840 × 1646. NOT PREPARED: the repo's brand photography is only 1024 px wide and would need a 5× upscale. It needs high-resolution brand imagery.

## App Privacy (VERIFY with backend and legal; this is based on what the app itself collects)
- **Contact info:** phone number (sign-in), name. Email only if the backend collects it. Linked to the user, used for app functionality.
- **User content:** messages between members, profile photo. Linked, app functionality.
- **Identifiers:** user ID, push notification token. Linked, app functionality.
- **Other:** membership and queue activity. Linked, app functionality.
- **Not collected:** precise location (no location permission), calendar contents (the app only writes events to the calendar).
- **Payments:** no in-app purchases. Membership billing happens on the website. VERIFY this is within App Review Guideline 3.1.

## App Review notes (draft)
Bluebird is a members' app for Bluebird Jets private flights. Sign-in uses a phone number and an SMS code. A dedicated review account and how to get its code will be provided separately; there's no hardcoded code or bypass in the app. Account deletion: Profile → Delete Account (needs a deployed backend; see #1841).

## Pricing and release
- **Price:** Free.
- **Availability:** VERIFY the countries.
- **Release:** Manual ("Manually release this version").
