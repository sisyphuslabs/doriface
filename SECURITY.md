# Security policy

## Reporting a vulnerability

Report it privately through [GitHub's advisory form](https://github.com/sisyphuslabs/doriterm/security/advisories/new). Please do not open a public issue, and do not describe an unpatched problem in a discussion or a chat: everyone who could use it reads that too.

A report that is fastest to act on carries:

- what you are running — the desktop app, the hosted web app, the host (`doriface-host`), the relay or a mesh line — and its version;
- what an attacker gains, and what they need to start from: a link, a paired device, a position on the network, a local account;
- the steps in order, with the messages you saw, your own keys, fingerprints and addresses redacted;
- anything you already know about the cause.

If you are unsure whether something is security-relevant, report it privately anyway: one report too many is cheaper than a public one. A crash, a wrong sentence or a missing shortcut is an ordinary issue.

## What to expect

This is a small project, so these are aims rather than a service agreement:

- we acknowledge a private report within three business days;
- we aim to ship a fix, or to explain why the report is not a vulnerability, within thirty days, and we say so when a fix will take longer;
- we credit the reporter in the advisory unless you ask us not to;
- we ask for the chance to ship a fix before the problem is written about publicly.

## Supported versions

| Version                         | Supported                                     |
| ------------------------------- | --------------------------------------------- |
| `0.1.x`, the latest release     | yes                                           |
| any earlier release             | no — upgrade to the latest one                |
| `dev`, a branch, a pull request | no — a fix is not promised on unreleased code |

Security fixes ship in the next release and are named in its release notes. A build from a branch, a pull request or a local change is not supported.

## Out of scope

- A vulnerability in a dependency that upstream already publishes as a CVE: report it there, and it reaches us as a version bump.
- A documented configuration choice, such as a host that listens on loopback only.
- An attacker who already has full control of the machine running the host.
- Spam, social engineering, and physical access.

## Scope

The code in this repository: `apps/web`, `apps/desktop`, `apps/host`, `apps/push-bridge`, `packages/*` and `tests/relay`. The relay's own deployment lives in a private repository; a report about the hosted relay is still welcome here, and we route it.
