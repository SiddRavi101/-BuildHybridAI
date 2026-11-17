# 📍 Pinpoint Field

**Offline-first field care documentation for search-and-rescue teams and remote work crews. Patient data stays on the device.**

When someone gets hurt far from help, the responder talks. Pinpoint reads standard first-aid protocol steps aloud from a fixed library. In the background it turns what the responder says into a structured patient care report. When EMS arrives, a **MIST handoff** is ready, and for employers a **draft OSHA Form 301** is too.

Patient data is processed **on-device with Gemini Nano** through **Firebase AI Logic hybrid inference**. It never leaves the laptop unless the responder explicitly allows it. The cloud does only safe work: generating training scenarios and writing de-identified summaries.

Built for **#BuildHybridAI 2026** · Web / Chrome Desktop · Apache-2.0

> ⚠️ **Demo content. Our medical advisor has not reviewed it yet. Not medical advice.** Pinpoint never diagnoses and never chooses treatment. The responder picks care steps from static protocol cards. The AI only structures what the responder said into draft fields, and the responder confirms each one.

---

## Why hybrid: privacy is the routing key

Most hybrid apps choose on-device or cloud based on *availability*. Pinpoint chooses based on **whether the data contains patient information (PHI)**. Every AI call goes through one function, `privacyRouter.run(task, input)` ([`src/firebase/runTask.ts`](src/firebase/runTask.ts)). The router's decision table lives in [`src/firebase/privacyRouter.ts`](src/firebase/privacyRouter.ts) and is unit-tested.

| Task | Contains PHI? | `InferenceMode` | If unavailable |
|---|---|---|---|
| Structure care report from speech/typing | **Yes** | `ONLY_ON_DEVICE` | Queue locally and say so; vitals/interventions still captured by local rules (no AI). Cloud **only** with explicit per-incident consent (`ONLY_IN_CLOUD`). |
| Polish handoff wording | **Yes** | `ONLY_ON_DEVICE` | Template-only export (no AI) |
| Team-lead summary | No (de-identified *by the router* first) | `PREFER_ON_DEVICE` | Cloud fallback allowed |
| Training drill scenario | No | `PREFER_IN_CLOUD` | On-device fallback when offline |

- **The badge is never a guess.** Every AI output shows 🔒 On-device or ☁️ Cloud. The label comes from the SDK's `response.inferenceSource`. Before each call the router also checks `LanguageModel.availability()`. It does this so a PHI task never waits on a model download and never silently goes to the cloud.
- **Defence in depth.** If a PHI task ever comes back with `inferenceSource === 'in_cloud'` without consent, the router discards the result and logs a violation.
- **Every routing decision is audited.** Each call writes `{task, modeRequested, modeUsed, timestamp}` to the hash-chained audit log.

## Features

| | |
|---|---|
| 🎙 **Voice-first capture** | Chrome on-device speech recognition (`processLocally`); typed input + quick-insert buttons always available |
| 📋 **Protocol walkthrough** | 6 static cards (severe bleeding, shock, hypothermia, heat illness, fracture/splinting, burns) read aloud with `speechSynthesis`, check-off steps |
| 🧾 **Live structured report** | Firebase AI Logic structured output (one JSON Schema for Nano `responseConstraint` and cloud `responseJsonSchema`), zod validation, one retry, then keeps the last good report. Every field is a **draft until confirmed**; confirmed or user-edited fields are never overwritten. |
| ⚙️ **No-AI safety net** | A deterministic parser records vitals ("pulse 112, BP 130 over 85") and named interventions even with no model at all |
| 🚑 **Exports** | MIST handoff (PDF / print / text), OSHA 301-style **draft for employer review** (PDF), full JSON record. All offline. |
| 🔗 **Hash-chained audit log** | SHA-256 via Web Crypto, every entry chained; **Verify integrity** button, plus a "simulate tampering" demo |
| ☁️ **Firestore sync** | Offline persistence queues writes until reconnect. **De-identified by default** (no transcript, year + duration only, names/phones/locations redacted, ages → ranges); identifiable sync is opt-in per incident |
| 🎓 **Training Mode** | Cloud-generated fictional drill scenarios with vitals progression and debrief questions |
| 📴 **Installable PWA** | Service worker precaches the app + protocol library; the full flow works with Wi-Fi off |
| 🛡 **App Check** | reCAPTCHA Enterprise in production, debug token on localhost |

## Architecture

```
 Responder ──voice/typing──▶ Timeline (IndexedDB) ──▶ Audit chain (SHA-256)
                                  │
                ┌─────────────────┼──────────────────────┐
                ▼                 ▼                      ▼
        Local rules (no AI)   privacyRouter.run(task)   Protocol cards (static JSON)
                │                 │                      │  speechSynthesis
                │     ┌───────────┴────────────┐         │
                │     ▼ PHI                    ▼ no PHI  │
                │  ONLY_ON_DEVICE         PREFER_ON_DEVICE / PREFER_IN_CLOUD
                │  Gemini Nano 🔒          (input de-identified) Gemini ☁️
                │     │                         │
                └────▶ Report (drafts → confirmed) ◀───┘
                              │
            ┌─────────────────┼───────────────────┐
            ▼                 ▼                   ▼
      MIST / OSHA 301 PDF   JSON export   Firestore (de-identified, offline queue)
```

```
src/
  firebase/   init.ts (App, App Check, Firestore persistent cache, anon auth)
              ai.ts (getAI + hybrid model factory) · onDevice.ts (Prompt API status)
              privacyRouter.ts (pure decision table) · runTask.ts (privacyRouter.run)
  features/   incident/ speech/ protocols/ report/ export/ audit/ sync/ training/
  ui/         StatusBar, ModeBadge, Settings
public/protocols/   static protocol library (cited public U.S. government sources)
```

### Firebase AI Logic usage (verified against `firebase@13.4.0` SDK source)

```ts
getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,          // chosen per task by the router
  onDeviceParams: {
    createOptions: { expectedInputs: [{ type: 'text', languages: ['en'] }],
                     initialPrompts: [{ role: 'system', content: [{ type: 'text', value: SYSTEM }] }] },
    promptOptions: { responseConstraint: jsonSchema },     // structured output on Nano
  },
  inCloudParams: { model: 'gemini-3.5-flash-lite', systemInstruction: SYSTEM,
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: jsonSchema } },
});
```

Reading the SDK source turned up three things that shaped this design. First, on-device sessions ignore `systemInstruction`, so the system prompt goes in `initialPrompts`. Second, `ONLY_ON_DEVICE` *waits* for a pending model download, so we check availability first. Third, the Chrome adapter only sends `image/jpeg` and `image/png` inline data on-device. Audio parts would therefore go to the cloud, which is why we don't use Nano audio input for speech.

## Setup

### 1. Run locally

```bash
git clone https://github.com/<you>/pinpoint-field && cd pinpoint-field
npm install
cp .env.example .env.local   # fill in (see below) — .env.local is git-ignored
npm run dev
```

The app runs **without** Firebase config too. Capture, protocols, local-rule structuring, exports and the audit log all work, and AI and sync are disabled with a clear message.

### 2. Firebase project

1. Create a Firebase project. Go to **AI Services → AI Logic** and enable the **Gemini Developer API**.
2. Register a **Web app** and copy its config into `.env.local` (`VITE_FIREBASE_*`).
3. **App Check:** register the web app with **reCAPTCHA Enterprise** and put the site key in `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. Turn on enforcement for Firebase AI Logic.
   - **Localhost / judges:** in dev builds the debug provider is on. Either put a registered debug token in `VITE_APPCHECK_DEBUG_TOKEN`, or leave it empty: the browser console then prints a token on first load, which you add under *App Check → Manage debug tokens*.
4. **Firestore:** create a database (production mode) and deploy the rules: `firebase deploy --only firestore:rules`.
5. **Authentication:** enable the **Anonymous** provider. Users don't log in.

### 3. Chrome with Gemini Nano (on-device)

Requires **Chrome Desktop 139+**. Check the [Firebase hybrid get-started page](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started) for the current list of flags. At the time of writing:

1. `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
2. `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Restart Chrome.
4. Open Pinpoint and click **Download model** in the status bar, or **Settings → Test hybrid call**. The model is large, so do this on good Wi-Fi before going offline. `chrome://on-device-internals` shows the model status.
5. *(Optional)* On-device speech: **Settings → Install on-device speech** (needs network once).

### 4. Tests

```bash
npm test                 # Vitest: hash chain, de-identification, privacy router, merge, rules, exports
npm run test:e2e         # Playwright: full incident flow with the network OFF
```

### 5. Deploy (Firebase Hosting)

```bash
cp .firebaserc.example .firebaserc   # set your project id
npm run deploy
```

## Testing instructions for judges

- **No login.** Anonymous auth is used.
- **Without Gemini Nano:** the cloud path still works. Training Mode and the team summary run in the cloud (☁️). Patient-data structuring is *deliberately blocked*, which is the privacy guarantee in action. Vitals and interventions are still captured by local rules (⚙️). To see cloud structuring, tick **"Cloud OK for this patient"** on an incident.
- **With Gemini Nano** (setup step 3): start an incident, turn Wi-Fi off and talk or type. The report fills in with 🔒 On-device badges.
- **Audit:** Audit tab → *Verify integrity* → *Simulate tampering* → *Verify* again.

## Safety

- No AI diagnosis, triage or treatment recommendations, ever. The model's system prompt restricts it to restating what the responder said.
- Care guidance comes only from the static protocol JSON in `public/protocols/`. Each card was written from a public U.S. government source cited on the card, and is marked pending medical-advisor review.
- Every AI-filled field is shown as a **Draft** until the responder confirms or edits it. Exports mark unconfirmed items.
- No real patient data in this repo or the demo. All cases are fictional.

## Pre-existing work (disclosure)

- **SecondLife** (our earlier prototype): the *idea* of a hash-chained audit log for care records came from SecondLife. The implementation here (`src/features/audit/hashChain.ts`) was written from scratch for this project. No SecondLife code was copied.
- Everything else in this repository was created during the #BuildHybridAI submission period (from Nov 17, 2026).
- Third-party open-source dependencies are listed in `package.json`.

## License

[Apache-2.0](LICENSE)
