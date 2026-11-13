# Rhine Launcher — Minecraft Java Game Service API application draft

Prepared: 2026-11-07

**DRAFT — NOT SUBMITTED. Replace every `[REPLACE_…]` field and have the actual application owner review the statements before submitting.**

This is a suggested set of responses, not a reproduction of the exact Microsoft Forms field order. The live form is JavaScript-rendered; its complete question layout was not available through the text fetch.

## 1. Application and publisher details

| Field | Proposed value |
| --- | --- |
| Application name | Rhine Launcher |
| Microsoft Application (client) ID | `c0161cf4-3180-4a1a-919b-19f75d039d32` |
| Publisher / authorized owner | `[REPLACE_PUBLISHER_NAME]` |
| Contact email monitored by the publisher | `[REPLACE_CONTACT_EMAIL]` |
| Public project / source URL | https://github.com/Arbousier1/rhine-launcher |
| Privacy policy URL | `[REPLACE_PUBLIC_PRIVACY_POLICY_URL]` |
| Build or commit supplied for review | `[REPLACE_REVIEW_BUILD_OR_COMMIT]` |
| Download / reviewer access instructions, if requested | `[REPLACE_REVIEW_DOWNLOAD_OR_ACCESS_INSTRUCTIONS]` |
| Platform | Windows desktop; TypeScript / Node.js / Electron / Cordis |
| Application category | Third-party Minecraft: Java Edition launcher |

The repository was publicly accessible when checked. Before submission, make sure the linked repository and review build actually contain the authentication fixes being described; the public version observed during preparation did not establish that the latest local changes had been published.

## 2. Short description — copy/paste

Rhine Launcher is a third-party desktop launcher for Minecraft: Java Edition. It provides user-managed game instances, game installation and launch management, and optional mod/resource management through separate plugins. We are requesting approval for our own Microsoft application registration to access the Minecraft Java game service APIs needed for user-initiated Microsoft sign-in and retrieval of the user's Java game profile. We do not request approval for another launcher's application ID, and we do not represent this application as an official Mojang or Microsoft product.

## 3. Requested API access and purpose — copy/paste

The inspected authentication implementation calls the following Minecraft service endpoints:

```text
POST https://api.minecraftservices.com/authentication/login_with_xbox
GET  https://api.minecraftservices.com/minecraft/profile
```

The first endpoint exchanges the user's Minecraft-scoped XSTS authorization for a Minecraft access token. The second retrieves the corresponding Java profile so the launcher can use the correct account-bound UUID and player name.

The Microsoft and Xbox stages preceding these calls use Microsoft OAuth device-code authorization, Xbox Live user authentication, and XSTS authorization with the relying party `rp://api.minecraftservices.com/`. They are not a publisher-operated authentication relay.

No skin-upload or additional Minecraft game-service endpoint is included in this request unless it is actually implemented and required by the reviewed build. A separate entitlements API check is not currently implemented in the inspected login chain; do not state otherwise in the form.

## 4. Microsoft sign-in and credentials — copy/paste

Microsoft sign-in is initiated by the user. The launcher obtains a device code using the scopes `XboxLive.signin offline_access` and the consumer Microsoft identity endpoint. The user completes authorization on Microsoft's own website; the application does not collect the user's Microsoft account password and does not use a client secret in this public-client flow.

The private device-code secret is retained only in the local backend's pending-flow state and is not returned in the public begin-login result. Pending flows have expiry and cancellation handling. A flow remains bound to the application ID and authority that started it; the application does not silently substitute another publisher's application ID during polling or refresh.

## 5. Account validation and failure handling — copy/paste

The inspected login chain verifies that the Xbox Live and XSTS user hashes exist and match before attempting the Minecraft token exchange. Microsoft sign-in is recorded as successful only after Minecraft returns a usable Java profile with a valid UUID and player name. Refresh does not replace a stored account with a different profile.

The launcher does not fabricate Minecraft credentials or convert a failed Microsoft sign-in into a successful online account. Separately labeled local/offline profiles are not presented as verified Microsoft ownership or online authentication.

OAuth device-code issuance alone is not treated as proof of Minecraft API approval or game ownership. Application-registration rejection, other HTTP permission failures, token rejection, rate limiting, and unavailable profiles are handled separately. A failure before the ownership/profile stage is not used to tell the user that they have not purchased the game.

## 6. Data storage and security — review carefully before copying

The current development implementation stores account records, including Microsoft refresh tokens and Minecraft access tokens, locally in JSON. Atomic writes are used, with file/directory mode requests of `0600` / `0700`; these are not a claim that Windows permissions were independently audited. **Application-level encryption at rest is not implemented in the inspected account-storage code.**

Public account projections remove authentication tokens. Public authentication diagnostics retain only allowlisted failure metadata, such as stage, HTTP status, fixed internal error code and whether the application identity was built-in or custom; they do not retain provider response bodies, usernames or token values.

The local HTTP backend binds to `127.0.0.1` and validates local hosts and request origins. Credential-bearing authentication requests use HTTPS and refuse redirects. The inspected sign-in path exchanges tokens with Microsoft/Xbox/Minecraft services, not with a publisher-operated token relay.

These statements describe the inspected authentication components. They are not a completed security audit of every optional plugin, market/news request or telemetry path. The final public privacy policy must describe the reviewed build and its enabled features accurately.

## 7. Removing an account — copy/paste

Removing an account deletes its locally stored account record, including the associated stored credentials. This action does not automatically revoke the user's Microsoft-side application consent. Users can manage or revoke that consent separately in their Microsoft account settings. The privacy policy and UI instructions should make that distinction clear.

## 8. Current integration failure — optional supporting explanation

The local diagnostic recorded the following sanitized result:

```json
{
  "occurredAt": "2026-11-07T01:36:19.977Z",
  "code": "MINECRAFT_APP_NOT_APPROVED",
  "stage": "minecraft-login",
  "application": "builtin",
  "upstreamStatus": 403
}
```

We are applying for the required review of our own application registration. Device-code issuance has been observed, but full Minecraft sign-in has not passed acceptance testing because the application's Minecraft token exchange is currently rejected. This diagnostic does not establish that a player lacks a game purchase.

Do not attach Microsoft passwords, client secrets, access/refresh tokens, identity-token payloads, raw authorization headers, or private device codes as evidence.

## 9. Owner confirmation before submission

- Confirm in Microsoft Entra that the submitting person is an owner or authorized representative of the exact Application (client) ID above.
- Fill in the publisher name, monitored email, published privacy policy, review build/commit and any requested access instructions.
- Check that the public source and review binary match the security statements. Do not claim that unpublished local changes are already available to reviewers.
- Do not claim encrypted credential storage unless it has been implemented and verified in the submitted build.
- Follow the actual live form's questions and terms. Do not use this draft to assert approval, a guaranteed review time, or permission that has not been granted.

## Official references

- [Mojang application-review form](https://aka.ms/mce-reviewappid)
- [Java Edition Game Service API Review or Application Process](https://minecrafthelp.zendesk.com/hc/en-us/articles/16254801392141-Java-Edition-Game-Service-API-Review-or-Application-Process)
- [Public article API used to verify the policy text](https://minecrafthelp.zendesk.com/api/v2/help_center/en-us/articles/16254801392141.json)
- [Public project repository checked during preparation](https://github.com/Arbousier1/rhine-launcher)

The policy describes manual review and allowlisting of new integrations. Registration of a public client and successful device-code issuance do not by themselves grant Minecraft Java game-service access.
