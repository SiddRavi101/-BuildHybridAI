# PROGRESS

## 2026-11-17: M0–M5 code complete (built in a cloud sandbox, no Firebase project yet)

### Verified here
- `tsc -b` clean · `vite build` OK · PWA service worker precaches 22 entries (app + protocol library).
- **Vitest: 30/30 passing.** Covers the hash chain (tamper, delete and forged-link detection), de-identification, the Privacy Router decision table, the extraction parser, the report merge (confirmed fields are never overwritten), the local vitals/intervention rules, and the MIST/OSHA builders.
- **Playwright e2e passing.** It starts an incident and then **goes offline**. It types entries and uses quick-insert. It checks that vitals and interventions are structured by local rules, and that PHI structuring is *blocked* with the privacy notice because there's no on-device model. It confirms a draft, edits a field, and walks a protocol card served from the SW cache. It exports the MIST + OSHA PDFs and checks the OSHA draft. Finally it verifies the audit chain, simulates tampering, and confirms verification then fails.
- Firebase AI Logic API checked against the **installed SDK source (`firebase@13.4.0`)**. The docs site couldn't be reached from the sandbox. Findings:
  - `InferenceMode` = `PREFER_ON_DEVICE | ONLY_ON_DEVICE | ONLY_IN_CLOUD | PREFER_IN_CLOUD`
  - `response.inferenceSource` (`on_device` | `in_cloud`) exists. The ModeBadge uses it.
  - On-device sessions ignore `systemInstruction`, so we use `onDeviceParams.createOptions.initialPrompts`.
  - On-device structured output uses `promptOptions.responseConstraint`. Cloud uses `generationConfig.responseJsonSchema`.
  - `ONLY_ON_DEVICE` blocks waiting for a pending download, so the router checks `LanguageModel.availability()` first.
  - Default cloud hybrid model: `gemini-3.5-flash-lite`.

### NOT yet verified (needs a human with a Firebase project + Chrome 139+)
- [ ] Real cloud call through Firebase AI Logic with App Check enforcement on (Settings → *Test hybrid call*).
- [ ] Real Gemini Nano structured extraction quality. Prompt and schema may need tuning, so try the demo script sentences.
- [ ] Streaming with `responseConstraint` on Nano (we stream, but only parse the final text).
- [ ] Chrome on-device speech (`SpeechRecognition.available/install` + `processLocally`). Detection works in headless Chromium, but recognition itself is untested.
- [ ] Firestore sync to a real project (offline queue → reconnect → synced), and the rules deploy.
- [ ] Anonymous auth while offline after a previous online session.
- [ ] Firebase Hosting deploy and fresh-visitor test.

### Speech decision (plan §4.3)
1. **Chosen: Chrome on-device Web Speech** (`processLocally = true`, with feature detection for the older `availableOnDevice` / `mode='ondevice-only'` shape). Audio stays on the laptop.
2. **Rejected: Gemini Nano audio via AI Logic.** In `firebase@13.4` the Chrome adapter only routes `image/jpeg` and `image/png` inline data on-device (`SUPPORTED_MIME_TYPES`), so audio parts would go to the cloud. That breaks the privacy model.
3. **Always available: typed input + quick-insert buttons.**
- Server-based Web Speech (audio goes to Google) is only offered when the user has ticked "Cloud OK for this patient", and is labelled ☁️.

### Known gaps / follow-ups
- Main JS bundle is ~1 MB (Firebase + jsPDF; jsPDF is already lazy-loaded). Fine for a PWA, but code-splitting Firestore/Auth would help first load.
- Protocol source URLs were written from memory of the public pages (DHS Stop the Bleed, MedlinePlus, CDC/NIOSH) and **must be checked by a human**, along with the content (medical advisor).
- Image input (Should-have #13) is not implemented.
- `knownNames` (names harvested from speech for de-identification) are stored locally only and excluded from every export and sync.

### Milestone status
| Milestone | Status |
|---|---|
| M0 Setup | Code done; needs a real Firebase project to see the "hello" call + badge |
| M1 Speech + timeline | ✅ (typed + quick-insert verified; on-device speech untested) |
| M2 Report extraction | ✅ code + tests; Nano quality untested |
| M3 Protocols + audit | ✅ verified e2e |
| M4 Export + sync + PWA | ✅ export/PWA verified offline; Firestore untested |
| M5 Training + polish | ✅ code; e2e ✅; deploy pending |
| M6 Video + docs | README done; video/Devpost are human tasks |
